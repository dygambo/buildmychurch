import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withOrg, type Tx } from "../db";
import { formResponses, forms, members, organisations, publicLinks, type FormField } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { blindIndex, decrypt, encrypt, randomToken } from "../crypto";
import { AppError, notFound } from "../errors";
import { enqueue } from "../jobs/queue";
import { emailLayout, esc, p } from "../emails/layout";
import { env } from "../env";
import { formatDate, formatDateTime } from "@/lib/format";
import { normalizeNgPhone } from "@/lib/phone";

export const FIELD_TYPES: Record<FormField["type"], string> = {
  short: "Short answer",
  long: "Paragraph",
  email: "Email",
  phone: "Phone number",
  number: "Number",
  date: "Date",
  choice: "One choice",
  multi: "Several choices",
  yesno: "Yes or no",
  section: "Section heading",
};

const fid = () => randomToken(6).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || Math.random().toString(36).slice(2, 10);
const f = (type: FormField["type"], label: string, extra: Partial<FormField> = {}): FormField => ({ id: fid(), type, label, required: type !== "section", ...extra });

/** Ready-made forms churches ask for most. */
export const FORM_TEMPLATES: { key: string; title: string; description: string; fields: () => FormField[] }[] = [
  { key: "blank", title: "Blank form", description: "", fields: () => [f("short", "Full name"), f("phone", "Phone number")] },
  {
    key: "workers",
    title: "Workers' training sign-up",
    description: "Register for the next workers-in-training class. Classes hold on Saturdays at 4pm for six weeks.",
    fields: () => [
      f("short", "Full name"),
      f("phone", "Phone number"),
      f("email", "Email", { required: false }),
      f("choice", "Which department would you like to serve in?", { options: ["Choir", "Ushering", "Media", "Protocol", "Children's Church", "Sanctuary Keepers", "Not sure yet"] }),
      f("yesno", "Have you completed the membership class?"),
      f("long", "Tell us briefly why you want to serve", { required: false }),
    ],
  },
  {
    key: "baptism",
    title: "Water baptism class",
    description: "Sign up for the baptism class and the next baptism service.",
    fields: () => [
      f("short", "Full name"),
      f("phone", "Phone number"),
      f("date", "Date of birth", { required: false }),
      f("date", "When did you give your life to Christ?", { required: false, help: "An approximate date is fine." }),
      f("yesno", "Have you been baptised by immersion before?"),
    ],
  },
  {
    key: "survey",
    title: "Member feedback survey",
    description: "Help us serve you better. Your answers go to the pastoral team only.",
    fields: () => [
      f("choice", "How long have you worshipped with us?", { options: ["Less than 6 months", "6 months to 2 years", "2 to 5 years", "More than 5 years"] }),
      f("choice", "How would you rate our Sunday service?", { options: ["Excellent", "Good", "Fair", "Poor"] }),
      f("multi", "Which would you like more of?", { options: ["Bible study", "Prayer meetings", "Youth programmes", "Marriage seminars", "Outreach", "Business and career clinics"] }),
      f("long", "Anything else you'd like the pastors to know?", { required: false }),
      f("short", "Your name", { required: false, help: "Leave empty to stay anonymous." }),
    ],
  },
  {
    key: "counselling",
    title: "Marriage counselling request",
    description: "For intending couples. The counselling unit will contact you to fix the first session.",
    fields: () => [
      f("short", "Your full name"),
      f("short", "Your fiancé(e)'s full name"),
      f("phone", "Phone number"),
      f("email", "Email", { required: false }),
      f("date", "Proposed wedding date", { required: false }),
      f("yesno", "Are you both members of this church?"),
    ],
  },
];

const fieldSchema = z
  .object({
    id: z.string().trim().min(1).max(20),
    type: z.enum(["short", "long", "email", "phone", "number", "date", "choice", "multi", "yesno", "section"]),
    label: z.string().trim().min(1, "Write the question.").max(200),
    help: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((v) => v || undefined),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  })
  .transform((x) => ({
    ...x,
    required: x.type === "section" ? false : x.required,
    options: x.type === "choice" || x.type === "multi" ? [...new Set(x.options ?? [])] : undefined,
  }));

export const formSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(3, "Give the form a title.").max(140),
    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .nullable()
      .transform((v) => v || null),
    fields: z.array(fieldSchema).min(1, "Add at least one question.").max(60),
    closesAt: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? new Date(`${v}:00+01:00`) : null)),
    maxResponses: z
      .union([z.string(), z.number()])
      .optional()
      .nullable()
      .transform((v, c) => {
        if (v === "" || v === null || v === undefined) return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
          c.addIssue({ code: "custom", message: "Enter a whole number, or leave it empty for no limit." });
          return z.NEVER;
        }
        return n;
      }),
    oneEach: z.boolean().default(false),
    thankYou: z
      .string()
      .trim()
      .max(500)
      .optional()
      .nullable()
      .transform((v) => v || null),
    notifyEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("Check the email address.")
      .optional()
      .nullable()
      .or(z.literal(""))
      .transform((v) => v || null),
  })
  .superRefine((v, c) => {
    const ids = new Set<string>();
    v.fields.forEach((x, i) => {
      if (ids.has(x.id)) c.addIssue({ code: "custom", path: ["fields", i, "label"], message: "This question is repeated." });
      ids.add(x.id);
      if ((x.type === "choice" || x.type === "multi") && (x.options?.length ?? 0) < 2) c.addIssue({ code: "custom", path: ["fields", i, "options"], message: "Add at least two choices." });
    });
    if (!v.fields.some((x) => x.type !== "section")) c.addIssue({ code: "custom", path: ["fields"], message: "Add at least one question." });
    if (v.oneEach && !v.fields.some((x) => (x.type === "phone" || x.type === "email") && x.required))
      c.addIssue({ code: "custom", path: ["oneEach"], message: "Add a required phone or email question so we can tell people apart." });
  });

async function loadForm(tx: Tx, id: string) {
  const [x] = await tx.select().from(forms).where(and(eq(forms.id, id), isNull(forms.deletedAt)));
  if (!x) throw notFound("That form");
  return x;
}

export async function createForm(tx: Tx, ctx: Actor, templateKey: string) {
  assertCan(ctx, "forms.manage", "build forms");
  const t = FORM_TEMPLATES.find((x) => x.key === templateKey) ?? FORM_TEMPLATES[0]!;
  const [x] = await tx
    .insert(forms)
    .values({
      orgId: ctx.org.id,
      title: t.key === "blank" ? "Untitled form" : t.title,
      description: t.description || null,
      fields: t.fields(),
      createdBy: ctx.user.id,
      createdByName: ctx.user.name,
    })
    .returning({ id: forms.id });
  await audit(tx, ctx, { action: "form.created", summary: `Created the form "${t.key === "blank" ? "Untitled form" : t.title}"`, entityType: "form", entityId: x!.id });
  return x!.id;
}

export async function saveForm(tx: Tx, ctx: Actor, input: z.output<typeof formSchema>) {
  assertCan(ctx, "forms.manage", "build forms");
  const x = await loadForm(tx, input.id!);
  // removing a question that has answers keeps the answers in the export, so nothing is lost
  await tx
    .update(forms)
    .set({
      title: input.title,
      description: input.description,
      fields: input.fields as FormField[],
      closesAt: input.closesAt,
      maxResponses: input.maxResponses,
      oneEach: input.oneEach,
      thankYou: input.thankYou,
      notifyEmail: input.notifyEmail,
    })
    .where(eq(forms.id, x.id));
  await audit(tx, ctx, { action: "form.updated", summary: `Saved the form "${input.title}"`, entityType: "form", entityId: x.id });
}

export async function formToken(tx: Tx, orgId: string, formId: string) {
  const [l] = await tx
    .select()
    .from(publicLinks)
    .where(and(eq(publicLinks.orgId, orgId), eq(publicLinks.kind, "form"), eq(publicLinks.targetId, formId), isNull(publicLinks.revokedAt)));
  if (l) return l.token;
  const token = randomToken(9);
  await tx.insert(publicLinks).values({ token, orgId, kind: "form", targetId: formId });
  return token;
}

export async function setFormStatus(tx: Tx, ctx: Actor, id: string, status: "open" | "closed" | "draft") {
  assertCan(ctx, "forms.manage", "open or close forms");
  const x = await loadForm(tx, id);
  if (status === "open") {
    const parsed = formSchema.safeParse({ ...x, closesAt: null, fields: x.fields });
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Finish the form before opening it.");
    if (x.closesAt && x.closesAt < new Date()) throw new AppError("The closing time has passed. Change it before opening the form.");
    await formToken(tx, ctx.org.id, id);
  }
  await tx.update(forms).set({ status }).where(eq(forms.id, id));
  await audit(tx, ctx, {
    action: `form.${status}`,
    summary: `${status === "open" ? "Opened" : status === "closed" ? "Closed" : "Moved to draft"} the form "${x.title}"`,
    entityType: "form",
    entityId: id,
  });
}

export async function duplicateForm(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "forms.manage", "build forms");
  const x = await loadForm(tx, id);
  const [n] = await tx
    .insert(forms)
    .values({
      orgId: ctx.org.id,
      title: `${x.title} (copy)`,
      description: x.description,
      fields: x.fields,
      maxResponses: x.maxResponses,
      oneEach: x.oneEach,
      thankYou: x.thankYou,
      notifyEmail: x.notifyEmail,
      createdBy: ctx.user.id,
      createdByName: ctx.user.name,
    })
    .returning({ id: forms.id });
  await audit(tx, ctx, { action: "form.duplicated", summary: `Copied the form "${x.title}"`, entityType: "form", entityId: n!.id });
  return n!.id;
}

export async function deleteForm(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "forms.manage", "delete forms");
  const x = await loadForm(tx, id);
  await tx.update(forms).set({ deletedAt: new Date(), status: "closed" }).where(eq(forms.id, id));
  await tx.update(publicLinks).set({ revokedAt: new Date() }).where(and(eq(publicLinks.kind, "form"), eq(publicLinks.targetId, id)));
  await audit(tx, ctx, { action: "form.deleted", summary: `Deleted the form "${x.title}"`, entityType: "form", entityId: id });
}

export async function listForms(tx: Tx, ctx: Actor) {
  assertCan(ctx, "forms.manage", "see forms");
  const rows = await tx
    .select({
      f: forms,
      responses: sql<number>`(select count(*) from form_responses r where r.form_id = forms.id)::int`,
      last: sql<Date | null>`(select max(r.created_at) from form_responses r where r.form_id = forms.id)`,
    })
    .from(forms)
    .where(isNull(forms.deletedAt))
    .orderBy(desc(forms.updatedAt));
  return rows.map((r) => ({ id: r.f.id, title: r.f.title, status: r.f.status, questions: r.f.fields.filter((x) => x.type !== "section").length, responses: r.responses, last: r.last ? new Date(r.last) : null, updatedAt: r.f.updatedAt }));
}
export type FormRow = Awaited<ReturnType<typeof listForms>>[number];

export async function getForm(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "forms.manage", "see forms");
  const x = await loadForm(tx, id);
  const [n] = await tx.select({ n: count() }).from(formResponses).where(eq(formResponses.formId, id));
  const [l] = await tx
    .select({ token: publicLinks.token })
    .from(publicLinks)
    .where(and(eq(publicLinks.kind, "form"), eq(publicLinks.targetId, id), isNull(publicLinks.revokedAt)));
  return { ...x, responses: Number(n?.n ?? 0), publicUrl: l ? `${env().APP_URL}/f/${l.token}` : null };
}

/* ================= filling in ================= */

export async function publicForm(token: string) {
  const [l] = await db.select().from(publicLinks).where(eq(publicLinks.token, token));
  if (!l || l.kind !== "form" || l.revokedAt || !l.targetId) return null;
  return withOrg(l.orgId, async (tx) => {
    const [x] = await tx.select().from(forms).where(and(eq(forms.id, l.targetId!), isNull(forms.deletedAt)));
    if (!x || x.status === "draft") return null;
    const [o] = await tx.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, l.orgId));
    const [n] = await tx.select({ n: count() }).from(formResponses).where(eq(formResponses.formId, x.id));
    const full = x.maxResponses !== null && Number(n?.n ?? 0) >= x.maxResponses;
    const past = !!x.closesAt && x.closesAt < new Date();
    return {
      orgId: l.orgId,
      church: o!.name,
      form: { id: x.id, title: x.title, description: x.description, fields: x.fields, thankYou: x.thankYou },
      closed: x.status === "closed" || full || past ? (full ? "This form has all the responses it needs." : "This form is closed.") : null,
    };
  });
}

type Answer = string | string[] | null;

/** Checks each answer against its question. Returns the cleaned answers or field errors keyed by question id. */
export function checkAnswers(fields: FormField[], raw: Record<string, unknown>) {
  const answers: Record<string, Answer> = {};
  const errors: Record<string, string> = {};
  for (const q of fields) {
    if (q.type === "section") continue;
    const v = raw[q.id];
    let out: Answer = null;
    if (q.type === "multi") {
      const list = (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((x) => q.options?.includes(x));
      out = list.length ? list : null;
    } else {
      const s = String(v ?? "").trim();
      if (s) {
        if (s.length > (q.type === "long" ? 5000 : 500)) errors[q.id] = "That answer is too long.";
        else if (q.type === "email" && !z.string().email().safeParse(s).success) errors[q.id] = "Check the email address.";
        else if (q.type === "phone") {
          const n = normalizeNgPhone(s);
          if (!n) errors[q.id] = "Enter a Nigerian number, e.g. 0803 123 4567.";
          else out = n;
        } else if (q.type === "number" && !Number.isFinite(Number(s.replace(/,/g, "")))) errors[q.id] = "Enter a number.";
        else if (q.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) errors[q.id] = "Choose a date.";
        else if ((q.type === "choice" || q.type === "yesno") && !(q.type === "yesno" ? ["Yes", "No"] : (q.options ?? [])).includes(s)) errors[q.id] = "Choose one of the options.";
        if (out === null && !errors[q.id]) out = q.type === "email" ? s.toLowerCase() : s;
      }
    }
    if (out === null && q.required && !errors[q.id]) errors[q.id] = q.type === "choice" || q.type === "multi" || q.type === "yesno" ? "Choose an answer." : "Answer this question.";
    answers[q.id] = out;
  }
  return { answers, errors };
}

export async function submitForm(token: string, raw: Record<string, unknown>) {
  const pub = await publicForm(token);
  if (!pub) throw new AppError("This form link isn't valid. Ask the church for the right one.");
  if (pub.closed) throw new AppError(pub.closed);
  const { answers, errors } = checkAnswers(pub.form.fields, raw);
  if (Object.keys(errors).length) throw new AppError("Please check the highlighted answers.", errors);
  return withOrg(pub.orgId, async (tx) => {
    const [x] = await tx.select().from(forms).where(eq(forms.id, pub.form.id)).for("update");
    const qs = x!.fields;
    const phoneQ = qs.find((q) => q.type === "phone" && answers[q.id]);
    const emailQ = qs.find((q) => q.type === "email" && answers[q.id]);
    const contact = (phoneQ ? answers[phoneQ.id] : emailQ ? answers[emailQ.id] : null) as string | null;
    const contactHash = blindIndex(contact);
    if (x!.oneEach && contactHash) {
      const [dup] = await tx
        .select({ id: formResponses.id })
        .from(formResponses)
        .where(and(eq(formResponses.formId, x!.id), eq(formResponses.contactHash, contactHash)));
      if (dup) throw new AppError("You've already filled this form. Thank you.");
    }
    if (x!.maxResponses !== null) {
      const [n] = await tx.select({ n: count() }).from(formResponses).where(eq(formResponses.formId, x!.id));
      if (Number(n?.n ?? 0) >= x!.maxResponses) throw new AppError("This form has all the responses it needs.");
    }
    const nameQ = qs.find((q) => q.type === "short" && /name/i.test(q.label) && answers[q.id]);
    const name = nameQ ? String(answers[nameQ.id]) : null;
    let memberId: string | null = null;
    if (phoneQ || emailQ) {
      const [m] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            isNull(members.deletedAt),
            phoneQ ? eq(members.phoneHash, blindIndex(answers[phoneQ.id] as string)!) : eq(members.emailHash, blindIndex(answers[emailQ!.id] as string)!),
          ),
        )
        .limit(1);
      memberId = m?.id ?? null;
    }
    const [r] = await tx
      .insert(formResponses)
      .values({ orgId: pub.orgId, formId: x!.id, answersEnc: encrypt(JSON.stringify(answers))!, name, contactHash, memberId })
      .returning({ id: formResponses.id });
    await audit(tx, { system: "Form", orgId: pub.orgId }, { action: "form.response", summary: `${name ?? "Someone"} filled the form "${x!.title}"`, entityType: "form", entityId: x!.id });
    if (x!.notifyEmail)
      await enqueue(
        tx,
        "email.send",
        {
          to: x!.notifyEmail,
          subject: `New response: ${x!.title}`,
          html: emailLayout({
            church: pub.church,
            heading: `${esc(name ?? "Someone")} filled "${esc(x!.title)}"`,
            bodyHtml: p(`Open the responses to read it. Answers aren't included in this email because they may be personal.`),
            button: { label: "See responses", url: `${env().APP_URL}/forms/${x!.id}/responses` },
          }),
        },
        { orgId: pub.orgId, dedupeKey: `form-resp:${r!.id}` },
      );
    return { thankYou: x!.thankYou };
  });
}

/* ================= responses ================= */

export async function listResponses(tx: Tx, ctx: Actor, formId: string) {
  assertCan(ctx, "forms.manage", "read responses");
  const x = await loadForm(tx, formId);
  const rows = await tx
    .select({ r: formResponses, first: members.firstName, last: members.lastName })
    .from(formResponses)
    .leftJoin(members, eq(members.id, formResponses.memberId))
    .where(eq(formResponses.formId, formId))
    .orderBy(desc(formResponses.createdAt))
    .limit(5000);
  return {
    form: x,
    responses: rows.map(({ r, first, last }) => ({
      id: r.id,
      name: r.name,
      memberId: r.memberId,
      memberName: first ? `${first} ${last}` : null,
      answers: JSON.parse(decrypt(r.answersEnc) ?? "{}") as Record<string, Answer>,
      createdAt: r.createdAt,
    })),
  };
}

/** Per-question tallies for choice questions: the summary view. */
export function tally(fields: FormField[], responses: { answers: Record<string, Answer> }[]) {
  return fields
    .filter((q) => q.type === "choice" || q.type === "multi" || q.type === "yesno")
    .map((q) => {
      const opts = q.type === "yesno" ? ["Yes", "No"] : (q.options ?? []);
      const counts = Object.fromEntries(opts.map((o) => [o, 0])) as Record<string, number>;
      let answered = 0;
      for (const r of responses) {
        const a = r.answers[q.id];
        if (a === null || a === undefined) continue;
        answered++;
        for (const v of Array.isArray(a) ? a : [a]) counts[v] = (counts[v] ?? 0) + 1;
      }
      return { id: q.id, label: q.label, answered, counts };
    });
}

export async function deleteResponse(tx: Tx, ctx: Actor, id: string) {
  assertCan(ctx, "forms.manage", "delete responses");
  const [r] = await tx.select().from(formResponses).where(eq(formResponses.id, id));
  if (!r) throw notFound("That response");
  await tx.delete(formResponses).where(eq(formResponses.id, id));
  await audit(tx, ctx, { action: "form.response_deleted", summary: `Deleted a response from ${r.name ?? "someone"}`, entityType: "form", entityId: r.formId });
}

export async function exportResponses(tx: Tx, ctx: Actor, formId: string) {
  const { form, responses } = await listResponses(tx, ctx, formId);
  await audit(tx, ctx, { action: "form.exported", summary: `Exported ${responses.length} responses to "${form.title}"`, entityType: "form", entityId: formId });
  const qs = form.fields.filter((q) => q.type !== "section");
  // answers to questions since removed are kept under their id
  const extra = [...new Set(responses.flatMap((r) => Object.keys(r.answers)))].filter((k) => !qs.some((q) => q.id === k));
  const seen = new Map<string, number>();
  const heads = qs.map((q) => {
    const n = (seen.get(q.label) ?? 0) + 1;
    seen.set(q.label, n);
    return n > 1 ? `${q.label} (${n})` : q.label;
  });
  const rows = responses.map((r) => {
    const row: Record<string, string | number> = { Submitted: formatDateTime(r.createdAt), "Member on record": r.memberName ?? "" };
    for (const [i, q] of qs.entries()) {
      const a = r.answers[q.id];
      row[heads[i]!] = Array.isArray(a) ? a.join(", ") : q.type === "date" && a ? formatDate(a) : (a ?? "");
    }
    for (const k of extra) {
      const a = r.answers[k];
      row[`(removed question ${k})`] = Array.isArray(a) ? a.join(", ") : (a ?? "");
    }
    return row;
  });
  return { title: form.title, rows };
}
