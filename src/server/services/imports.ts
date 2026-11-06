import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { Tx } from "../db";
import { branches, groupMembers, groups, importJobs, members, memberTags, consents } from "../db/schema";
import type { Actor } from "../auth/context";
import { assertCan } from "../auth/context";
import { audit } from "../audit";
import { blindIndex } from "../crypto";
import { AppError, notFound } from "../errors";
import { normalizeNgPhone } from "@/lib/phone";
import { TITLES } from "@/lib/ng";
import { createMember, memberSchema, type MemberInput } from "./members";

export const MAX_IMPORT_ROWS = 5000;
/** Each parsed row remembers its line in the original file, so problems point at the right row. */
export const ROW_KEY = "__row";

/** Fields a column can be mapped to, with the header names churches commonly use for them. */
export const IMPORT_FIELDS = {
  fullName: { label: "Full name", synonyms: ["name", "full name", "fullname", "member name", "names"] },
  title: { label: "Title", synonyms: ["title", "salutation"] },
  firstName: {
    label: "First name",
    synonyms: ["first name", "firstname", "first", "given name", "forename", "other names"],
  },
  middleName: { label: "Middle name", synonyms: ["middle name", "middlename", "middle"] },
  lastName: { label: "Surname", synonyms: ["surname", "last name", "lastname", "family name", "last"] },
  gender: { label: "Gender", synonyms: ["gender", "sex", "m/f"] },
  phone: {
    label: "Phone",
    synonyms: [
      "phone",
      "phone number",
      "mobile",
      "mobile number",
      "gsm",
      "telephone",
      "tel",
      "whatsapp",
      "phone no",
      "contact",
    ],
  },
  email: { label: "Email", synonyms: ["email", "email address", "e-mail", "mail"] },
  birthday: { label: "Birthday", synonyms: ["birthday", "date of birth", "dob", "birth date", "birthdate", "d.o.b"] },
  maritalStatus: { label: "Marital status", synonyms: ["marital status", "marital", "married"] },
  anniversary: { label: "Wedding anniversary", synonyms: ["anniversary", "wedding anniversary", "wedding date"] },
  address: { label: "Address", synonyms: ["address", "home address", "residential address"] },
  area: { label: "Area", synonyms: ["area", "location", "neighbourhood", "neighborhood", "city", "lga"] },
  occupation: { label: "Occupation", synonyms: ["occupation", "profession", "job"] },
  branch: { label: "Branch", synonyms: ["branch", "campus", "assembly", "parish"] },
  department: { label: "Department", synonyms: ["department", "unit", "dept", "ministry", "workforce unit"] },
  cell: { label: "Home cell", synonyms: ["cell", "home cell", "house fellowship", "fellowship", "cell group"] },
  stage: { label: "Stage", synonyms: ["stage", "membership", "member type", "category"] },
  joinDate: { label: "Joined on", synonyms: ["join date", "date joined", "joined", "membership date", "first visit"] },
  consentMessaging: { label: "Agreed to SMS", synonyms: ["sms consent", "consent", "agreed to sms", "receive sms"] },
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;
export type Mapping = Record<string, ImportField | "">;
export type ImportProblem = { row: number; problem: string; value?: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function autoMap(headers: string[]): Mapping {
  const used = new Set<string>();
  const out: Mapping = {};
  for (const h of headers) {
    const n = norm(h);
    const hit = (Object.keys(IMPORT_FIELDS) as ImportField[]).find(
      (f) => !used.has(f) && (IMPORT_FIELDS[f].synonyms as readonly string[]).some((x) => norm(x) === n),
    );
    out[h] = hit ?? "";
    if (hit) used.add(hit);
  }
  // A "name" column alongside first/last columns is probably not a full name
  if (used.has("fullName") && used.has("firstName") && used.has("lastName"))
    for (const h of headers) if (out[h] === "fullName") out[h] = "";
  return out;
}

/* ---------- reading files ---------- */

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text) return String(o.text);
    if (o.result !== undefined) return cellText(o.result);
    if (o.hyperlink) return o.hyperlink.replace(/^mailto:/, "");
  }
  return String(v).trim();
}

export async function readSpreadsheet(
  name: string,
  data: ArrayBuffer,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const lower = name.toLowerCase();
  let table: string[][];
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    const text = new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    table = parsed.data.map((r) => r.map((c) => String(c ?? "").trim()));
  } else if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data);
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) throw new AppError("That workbook has no data in it.");
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = [];
      for (let c = 1; c <= ws.actualColumnCount; c++) vals.push(cellText(row.getCell(c).value));
      table.push(vals);
    });
  } else throw new AppError("Upload a .csv or .xlsx file. Old .xls files can be saved as .xlsx from Excel.");
  // the header row is the first row with at least two filled cells
  const hi = table.findIndex((r) => r.filter(Boolean).length >= 2);
  if (hi < 0) throw new AppError("We couldn't find a header row. The first row should name the columns.");
  const rawHeaders = table[hi]!;
  const headers: string[] = [];
  rawHeaders.forEach((h, i) => {
    let label = h.trim() || `Column ${i + 1}`;
    while (headers.includes(label)) label += " (2)";
    headers.push(label);
  });
  const out = table
    .map((r, i) => ({ r, line: i + 1 }))
    .slice(hi + 1)
    .filter(({ r }) => r.some((c) => c.trim()))
    .map(({ r, line }) => ({
      ...Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])),
      [ROW_KEY]: String(line),
    }));
  if (!out.length) throw new AppError("The file has a header row but no people under it.");
  if (out.length > MAX_IMPORT_ROWS)
    throw new AppError(
      `That file has ${out.length.toLocaleString()} rows. Import up to ${MAX_IMPORT_ROWS.toLocaleString()} at a time by splitting the file.`,
    );
  return { headers, rows: out };
}

/* ---------- interpreting values ---------- */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Understands 12/03/1990 (day first, as written in Nigeria), 1990-03-12, 12 March, March 12, 12-Mar-90 and Excel serials. */
export function parseBirthday(raw: string): { day: number; month: number; year: number | null } | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/,/g, " ");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  const fix = (y: string | undefined) => {
    if (!y) return null;
    const n = Number(y);
    if (y.length === 2) return n > new Date().getFullYear() % 100 ? 1900 + n : 2000 + n;
    return n;
  };
  const ok = (day: number, month: number, year: number | null) =>
    month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate()
      ? { day, month, year }
      : null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ok(+m[3]!, +m[2]!, +m[1]!);
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/))) return ok(+m[1]!, +m[2]!, fix(m[3]));
  if ((m = s.match(/^(\d{1,2})[\s\-/]*([a-z]{3,9})[\s\-/]*(\d{2,4})?$/))) {
    const mi = MONTHS.indexOf(m[2]!.slice(0, 3));
    return mi < 0 ? null : ok(+m[1]!, mi + 1, fix(m[3]));
  }
  if ((m = s.match(/^([a-z]{3,9})[\s\-/]*(\d{1,2})(?:[\s\-/]+(\d{4}))?$/))) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3));
    return mi < 0 ? null : ok(+m[2]!, mi + 1, fix(m[3]));
  }
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return ok(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
  }
  return null;
}

function parseDate(raw: string): string | null {
  const b = parseBirthday(raw);
  if (!b || !b.year) return null;
  return `${b.year}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`;
}

function parseGender(raw: string): "male" | "female" | null {
  const s = raw.trim().toLowerCase();
  if (["m", "male", "man", "boy", "brother", "bro"].includes(s)) return "male";
  if (["f", "female", "woman", "girl", "sister", "sis"].includes(s)) return "female";
  return null;
}

const STAGE_WORDS: Record<string, MemberInput["stage"]> = {
  member: "member",
  members: "member",
  "full member": "member",
  worker: "member",
  regular: "regular",
  "first timer": "first_timer",
  "first-timer": "first_timer",
  firsttimer: "first_timer",
  "new convert": "first_timer",
  "second timer": "second_timer",
  visitor: "visitor",
  guest: "visitor",
};

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  let title: string | null = null;
  const t = (TITLES as readonly string[]).find(
    (x) => x.toLowerCase().replace(/\.$/, "") === parts[0]?.toLowerCase().replace(/\.$/, ""),
  );
  if (t && parts.length > 2) {
    title = t;
    parts.shift();
  }
  // Nigerian lists usually write SURNAME first when it's in capitals: "ADEYEMI Tunde"
  if (parts.length >= 2 && parts[0] === parts[0]!.toUpperCase() && parts[1] !== parts[1]!.toUpperCase()) {
    const [last, ...rest] = parts;
    return { title, firstName: rest[0]!, middleName: rest.slice(1).join(" ") || null, lastName: last! };
  }
  if (parts.length === 1) return { title, firstName: parts[0]!, middleName: null, lastName: "" };
  return { title, firstName: parts[0]!, middleName: parts.slice(1, -1).join(" ") || null, lastName: parts.at(-1)! };
}

const titleCase = (s: string) =>
  s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : s;

export type PreparedRow = { row: number; input: MemberInput; department?: string; cell?: string };

/**
 * Turns spreadsheet rows into member records and lists every problem with its row number,
 * so the person importing can fix the file. Nothing is written here.
 */
export function prepareRows(
  rows: Record<string, string>[],
  mapping: Mapping,
  ctx: {
    branches: { id: string; name: string; code: string }[];
    defaultBranchId: string;
    existingPhoneHashes: Set<string>;
  },
) {
  const col = (f: ImportField) => Object.keys(mapping).find((h) => mapping[h] === f);
  const get = (r: Record<string, string>, f: ImportField) => {
    const h = col(f);
    return h ? (r[h] ?? "").trim() : "";
  };
  const problems: ImportProblem[] = [];
  const ok: PreparedRow[] = [];
  const seenPhones = new Map<string, number>();
  const hasNames = !!col("fullName") || (!!col("firstName") && !!col("lastName"));
  if (!hasNames)
    return {
      ok,
      problems: [
        { row: 0, problem: "Choose which column has the names (a full name column, or first name and surname)." },
      ],
    };
  if (!col("gender"))
    problems.push({ row: 0, problem: "No gender column chosen. Everyone without one will be skipped." });

  rows.forEach((r, i) => {
    const row = Number(r[ROW_KEY]) || i + 2; // line in the original file
    const rowProblems: ImportProblem[] = [];
    let { title, firstName, middleName, lastName } = {
      title: get(r, "title") || null,
      firstName: titleCase(get(r, "firstName")),
      middleName: titleCase(get(r, "middleName")) || null,
      lastName: titleCase(get(r, "lastName")),
    };
    const full = get(r, "fullName");
    if (full && (!firstName || !lastName)) {
      const s = splitName(full);
      title ??= s.title;
      firstName ||= titleCase(s.firstName);
      lastName ||= titleCase(s.lastName);
      middleName ??= s.middleName ? titleCase(s.middleName) : null;
    }
    if (!firstName || !lastName)
      rowProblems.push({
        row,
        problem: "Needs both a first name and a surname.",
        value: full || firstName || lastName,
      });

    const gRaw = get(r, "gender");
    const gender = parseGender(gRaw);
    if (!gender)
      rowProblems.push({ row, problem: gRaw ? "Gender should be Male or Female." : "Gender is missing.", value: gRaw });

    const pRaw = get(r, "phone");
    // some sheets put two numbers in one cell; keep the first
    const phone = pRaw ? normalizeNgPhone(pRaw.split(/[,/;]| or /)[0]!) : null;
    if (pRaw && !phone) rowProblems.push({ row, problem: "Phone number isn't a valid Nigerian number.", value: pRaw });
    if (phone) {
      const h = blindIndex(phone)!;
      if (ctx.existingPhoneHashes.has(h))
        rowProblems.push({ row, problem: "Someone with this phone number is already on record.", value: pRaw });
      else if (seenPhones.has(phone))
        rowProblems.push({ row, problem: `Same phone number as row ${seenPhones.get(phone)}.`, value: pRaw });
      else seenPhones.set(phone, row);
    }

    const email = get(r, "email").toLowerCase();
    const bRaw = get(r, "birthday");
    const bday = bRaw ? parseBirthday(bRaw) : null;
    if (bRaw && !bday)
      rowProblems.push({ row, problem: "Birthday isn't a date we recognise. Use 25/12/1990 or 25 Dec.", value: bRaw });

    const brRaw = get(r, "branch");
    let branchId = ctx.defaultBranchId;
    if (brRaw) {
      const b = ctx.branches.find((x) => norm(x.name) === norm(brRaw) || x.code.toLowerCase() === brRaw.toLowerCase());
      if (!b) rowProblems.push({ row, problem: "No branch with this name.", value: brRaw });
      else branchId = b.id;
    }
    const sRaw = norm(get(r, "stage"));
    const stage = sRaw ? STAGE_WORDS[sRaw] : "member";
    if (sRaw && !stage)
      rowProblems.push({
        row,
        problem: "Stage should be Member, Regular, First timer or Visitor.",
        value: get(r, "stage"),
      });
    const mRaw = norm(get(r, "maritalStatus"));
    const marital = mRaw
      ? (["single", "married", "widowed", "divorced", "separated"].find((x) => mRaw.startsWith(x.slice(0, 4))) ?? "")
      : "";
    const jRaw = get(r, "joinDate");
    const joinDate = jRaw ? parseDate(jRaw) : null;
    const aRaw = get(r, "anniversary");
    const anniversary = aRaw ? parseDate(aRaw) : null;
    const cRaw = norm(get(r, "consentMessaging"));

    const input: MemberInput = {
      branchId,
      title: title ?? undefined,
      firstName,
      middleName: middleName ?? undefined,
      lastName,
      gender: gender ?? "male",
      dobDay: bday?.day ?? null,
      dobMonth: bday?.month ?? null,
      dobYear: bday?.year ?? null,
      maritalStatus: marital as MemberInput["maritalStatus"],
      anniversary: anniversary ?? undefined,
      phone: phone ?? undefined,
      email: email || undefined,
      address: get(r, "address") || undefined,
      area: get(r, "area") || undefined,
      occupation: get(r, "occupation") || undefined,
      stage: stage ?? "member",
      joinDate: joinDate ?? undefined,
      consentMessaging: ["yes", "y", "true", "1", "agreed"].includes(cRaw),
    };
    if (!rowProblems.length) {
      const check = memberSchema.safeParse(input);
      if (!check.success)
        for (const issue of check.error.issues.slice(0, 2))
          rowProblems.push({ row, problem: issue.message, value: String(issue.path[0] ?? "") });
    }
    if (rowProblems.length) problems.push(...rowProblems);
    else ok.push({ row, input, department: get(r, "department") || undefined, cell: get(r, "cell") || undefined });
  });
  return { ok, problems };
}

/* ---------- import jobs ---------- */

async function branchContext(tx: Tx, ctx: Actor) {
  const list = await tx
    .select({ id: branches.id, name: branches.name, code: branches.code, level: branches.level })
    .from(branches)
    .where(isNull(branches.archivedAt));
  const allowed = ctx.branchIds.length ? list.filter((b) => ctx.branchIds.includes(b.id)) : list;
  const hashes = await tx
    .select({ h: members.phoneHash })
    .from(members)
    .where(and(isNull(members.deletedAt), sql`${members.phoneHash} is not null`));
  return {
    branches: allowed,
    defaultBranchId: (allowed.find((b) => b.level === "hq") ?? allowed[0])!.id,
    existingPhoneHashes: new Set(hashes.map((h) => h.h!)),
  };
}

export async function startImport(tx: Tx, ctx: Actor, file: { name: string; data: ArrayBuffer }) {
  assertCan(ctx, "members.import", "import members");
  const { headers, rows } = await readSpreadsheet(file.name, file.data);
  const mapping = autoMap(headers);
  const [job] = await tx
    .insert(importJobs)
    .values({ orgId: ctx.org.id, filename: file.name, totalRows: rows.length, rows, createdBy: ctx.user.id })
    .returning({ id: importJobs.id });
  const result = await checkImport(tx, ctx, job!.id, mapping);
  return { jobId: job!.id, headers, mapping, sample: rows.slice(0, 5), ...result };
}

export async function checkImport(tx: Tx, ctx: Actor, jobId: string, mapping: Mapping) {
  assertCan(ctx, "members.import", "import members");
  const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
  if (!job) throw notFound("That import");
  if (job.status !== "validated") throw new AppError("This import has already been completed.");
  const { ok, problems } = prepareRows(job.rows as Record<string, string>[], mapping, await branchContext(tx, ctx));
  await tx.update(importJobs).set({ validRows: ok.length, report: problems }).where(eq(importJobs.id, jobId));
  return { total: job.totalRows, valid: ok.length, problems: problems.slice(0, 500), problemCount: problems.length };
}

/** Adds every valid row in one transaction: either all of them are added, or none are. */
export async function commitImport(tx: Tx, ctx: Actor, jobId: string, mapping: Mapping) {
  assertCan(ctx, "members.import", "import members");
  const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for("update");
  if (!job) throw notFound("That import");
  if (job.status !== "validated") throw new AppError("This import has already been completed.");
  const bctx = await branchContext(tx, ctx);
  const { ok } = prepareRows(job.rows as Record<string, string>[], mapping, bctx);
  if (!ok.length) throw new AppError("There are no valid rows to import. Fix the problems listed and upload again.");

  const groupCache = new Map<string, string>();
  const createdGroups: string[] = [];
  async function groupId(kind: "department" | "cell", name: string, branchId: string) {
    const key = `${kind}|${branchId}|${name.toLowerCase()}`;
    if (groupCache.has(key)) return groupCache.get(key)!;
    const [g] = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.kind, kind), eq(groups.branchId, branchId), sql`lower(${groups.name}) = lower(${name})`));
    let id = g?.id;
    if (!id) {
      const [n] = await tx
        .insert(groups)
        .values({ orgId: ctx.org.id, kind, name, branchId })
        .returning({ id: groups.id });
      id = n!.id;
      createdGroups.push(name);
    }
    groupCache.set(key, id);
    return id;
  }

  const ids: string[] = [];
  for (const r of ok) {
    const m = await createMember(tx, ctx, r.input, {
      allowDuplicate: true,
      method: `import: ${job.filename}`,
      quiet: true,
    });
    ids.push(m.id);
    for (const [kind, name] of [
      ["department", r.department],
      ["cell", r.cell],
    ] as const) {
      if (!name) continue;
      for (const one of name
        .split(/[,;/]/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        const gid = await groupId(kind, one, r.input.branchId);
        await tx.insert(groupMembers).values({ orgId: ctx.org.id, groupId: gid, memberId: m.id }).onConflictDoNothing();
      }
    }
  }
  await tx
    .update(importJobs)
    .set({ status: "committed", committedAt: new Date(), memberIds: ids, validRows: ids.length, rows: [] })
    .where(eq(importJobs.id, jobId));
  await audit(tx, ctx, {
    action: "member.imported",
    summary: `Imported ${ids.length} member${ids.length === 1 ? "" : "s"} from ${job.filename}${createdGroups.length ? ` and created ${createdGroups.length} group${createdGroups.length === 1 ? "" : "s"}` : ""}`,
    entityType: "import",
    entityId: jobId,
  });
  return { added: ids.length, skipped: job.totalRows - ids.length, groupsCreated: createdGroups };
}

/** Undoes an import within 7 days, removing exactly the people it added (and nothing they've gained since, like giving). */
export async function undoImport(tx: Tx, ctx: Actor, jobId: string) {
  assertCan(ctx, "members.import", "undo imports");
  const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId)).for("update");
  if (!job) throw notFound("That import");
  if (job.status !== "committed") throw new AppError("Only completed imports can be undone.");
  if (job.committedAt && Date.now() - job.committedAt.getTime() > 7 * 86400000)
    throw new AppError("Imports can be undone for 7 days. Remove these members individually instead.");
  const ids = job.memberIds;
  if (ids.length) {
    await tx.delete(groupMembers).where(inArray(groupMembers.memberId, ids));
    await tx.delete(memberTags).where(inArray(memberTags.memberId, ids));
    await tx.delete(consents).where(inArray(consents.memberId, ids));
    await tx.delete(members).where(inArray(members.id, ids));
  }
  await tx.update(importJobs).set({ status: "rolled_back" }).where(eq(importJobs.id, jobId));
  await audit(tx, ctx, {
    action: "member.import_undone",
    summary: `Undid the import of ${job.filename} (${ids.length} member${ids.length === 1 ? "" : "s"} removed)`,
    entityType: "import",
    entityId: jobId,
  });
  return ids.length;
}

export async function recentImports(tx: Tx) {
  return tx
    .select({
      id: importJobs.id,
      filename: importJobs.filename,
      status: importJobs.status,
      totalRows: importJobs.totalRows,
      validRows: importJobs.validRows,
      committedAt: importJobs.committedAt,
      createdAt: importJobs.createdAt,
      canUndo: sql<boolean>`${importJobs.status} = 'committed' and ${importJobs.committedAt} > now() - interval '7 days'`,
    })
    .from(importJobs)
    .where(sql`${importJobs.status} <> 'validated' or ${importJobs.createdAt} > now() - interval '1 day'`)
    .orderBy(sql`${importJobs.createdAt} desc`)
    .limit(10);
}
