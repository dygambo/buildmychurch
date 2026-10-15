import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, Mail, MessageCircle, Phone, ShieldCheck, ShieldOff } from "lucide-react";
import { requireCtx } from "@/server/auth/context";
import { withOrg } from "@/server/db";
import { getMember } from "@/server/services/members";
import { listBranches } from "@/server/services/org";
import { listTags } from "@/server/services/members";
import { memberAttendance } from "@/server/services/attendance";
import { AppError } from "@/server/errors";
import { NoAccess } from "@/components/no-access";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { formatDate, formatDateTime, fullName, timeAgo } from "@/lib/format";
import { formatPhone, localPhone } from "@/lib/phone";
import { MONTHS, STAGE_LABEL, STAGE_TONE, STATUS_LABEL } from "../labels";
import { FamilyCard, ProfileActions, StartFollowup, TagEditor } from "./view";

export const metadata: Metadata = { title: "Member" };

const BAPTISM: Record<string, string> = {
  none: "Not yet",
  water: "Water baptism",
  spirit: "Holy Spirit baptism",
  both: "Water and Holy Spirit",
};
const GROUP_KIND: Record<string, string> = { department: "Department", cell: "Home cell", ministry: "Ministry" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 text-[13px] max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children ?? <span className="text-faint">—</span>}</dd>
    </div>
  );
}

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.can("members.read")) return <NoAccess what="see members" />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let data;
  try {
    data = await withOrg(ctx.org.id, async (tx) => ({
      m: await getMember(tx, ctx, id),
      branches: await listBranches(tx),
      tags: await listTags(tx),
      att: ctx.can("attendance.read") ? await memberAttendance(tx, id) : null,
    }));
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { m, branches, tags, att } = data;
  const name = fullName(m);
  const age = m.dobYear && m.dobMonth && m.dobDay ? ageOn(m.dobYear, m.dobMonth, m.dobDay) : null;
  const wa = m.phone ? `https://wa.me/${m.phone.replace("+", "")}` : null;
  const canWrite = ctx.can("members.write");

  return (
    <>
      <Link href="/members" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Members
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold max-sm:text-[19px]">{name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="font-mono">{m.memberNo}</span>
            <Badge tone={STAGE_TONE[m.stage]}>{STAGE_LABEL[m.stage]}</Badge>
            {m.status !== "active" && <Badge tone="warn">{STATUS_LABEL[m.status]}</Badge>}
            <span>· {m.branchName}</span>
            {m.dnd && (
              <Badge tone="bad">
                <ShieldOff className="size-3" /> Do not disturb
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {m.phone && (
            <>
              <a
                href={`tel:${m.phone}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
              >
                <Phone className="size-4" /> Call
              </a>
              <a
                href={wa!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
              >
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            </>
          )}
          {ctx.can("followup.manage") && <StartFollowup memberId={m.id} firstTimer={m.stage === "first_timer"} />}
          {canWrite && (
            <ProfileActions
              member={{
                ...m,
                phone: localPhone(m.phone),
                anniversary: m.anniversary ? String(m.anniversary) : null,
                joinDate: String(m.joinDate),
                foundationSchoolAt: m.foundationSchoolAt ? String(m.foundationSchoolAt) : null,
              }}
              branches={branches.map((b) => ({ id: b.id, name: b.name }))}
              canSensitive={ctx.can("members.read_sensitive")}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 max-lg:grid-cols-1">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              {m.hasHidden && (
                <Note icon={<Lock />} className="mb-2">
                  Email and address are on record but hidden for your role.
                </Note>
              )}
              <dl className="divide-y divide-line">
                <Row label="Phone">{m.phone ? <span className="font-mono">{formatPhone(m.phone)}</span> : null}</Row>
                {m.sensitiveVisible && (
                  <>
                    <Row label="Email">
                      {m.email ? (
                        <a className="inline-flex items-center gap-1 text-accent" href={`mailto:${m.email}`}>
                          <Mail className="size-3.5" />
                          {m.email}
                        </a>
                      ) : null}
                    </Row>
                    <Row label="Address">{m.address}</Row>
                  </>
                )}
                <Row label="Area">{m.area}</Row>
                <Row label="Gender">{m.gender === "male" ? "Male" : "Female"}</Row>
                <Row label="Birthday">
                  {m.dobDay && m.dobMonth
                    ? `${m.dobDay} ${MONTHS[m.dobMonth - 1]}${m.dobYear ? ` ${m.dobYear}` : ""}${age != null ? ` (${age})` : ""}`
                    : null}
                </Row>
                <Row label="Marital status">
                  {m.maritalStatus ? m.maritalStatus[0]!.toUpperCase() + m.maritalStatus.slice(1) : null}
                </Row>
                {m.anniversary && <Row label="Anniversary">{formatDate(String(m.anniversary), "long")}</Row>}
                <Row label="Occupation">{m.occupation}</Row>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Church life" />
            <CardBody>
              <dl className="divide-y divide-line">
                <Row label="Branch">{m.branchName}</Row>
                <Row label="Joined">{formatDate(String(m.joinDate), "long")}</Row>
                <Row label="Baptism">{BAPTISM[m.baptism]}</Row>
                <Row label="Foundation school">
                  {m.foundationSchoolAt ? `Completed ${formatDate(String(m.foundationSchoolAt))}` : null}
                </Row>
                <Row label="How they heard">{m.howHeard}</Row>
                {(m.bloodGroup || m.genotype) && (
                  <Row label="Health">
                    {[m.bloodGroup && `Blood group ${m.bloodGroup}`, m.genotype && `Genotype ${m.genotype}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </Row>
                )}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              {m.history.length ? (
                <ol className="flex flex-col gap-3">
                  {m.history.map((h) => (
                    <li key={h.id} className="flex gap-3 text-[13px]">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                      <div className="min-w-0">
                        <div>{h.summary}</div>
                        <div className="text-xs text-faint" title={formatDateTime(h.at)}>
                          {h.actorName} · {timeAgo(h.at)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[13px] text-muted">No changes recorded yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          {att && (
            <Card>
              <CardHeader
                title="Attendance"
                action={
                  <span className="text-[13px] text-muted">
                    {att.total} service{att.total === 1 ? "" : "s"} in total
                  </span>
                }
              />
              <CardBody>
                {att.recent.length ? (
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {att.recent.slice(0, 6).map((s) => (
                      <li key={s.id} className="flex justify-between gap-2">
                        <Link href={`/attendance/${s.id}`} className="truncate hover:text-accent">
                          {s.name}
                        </Link>
                        <span className="shrink-0 text-faint">{formatDate(String(s.date))}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">No attendance recorded yet.</p>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Groups" />
            <CardBody>
              {m.groups.length ? (
                <ul className="flex flex-col gap-2">
                  {m.groups.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <Link href={`/groups/${g.id}`} className="font-medium hover:text-accent">
                        {g.name}
                      </Link>
                      <span className="flex items-center gap-1.5">
                        {g.role !== "member" && (
                          <Badge tone="accent">{g.role === "leader" ? "Leader" : "Assistant"}</Badge>
                        )}
                        <span className="text-xs text-faint">{GROUP_KIND[g.kind]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">Not in any department or home cell yet.</p>
              )}
            </CardBody>
          </Card>
          <TagEditor
            memberId={m.id}
            current={m.tags.map((t) => t.name)}
            all={tags.map((t) => t.name)}
            canWrite={canWrite}
          />
          <FamilyCard
            memberId={m.id}
            name={m.firstName}
            householdName={m.householdName}
            people={m.household.map((h) => ({ id: h.id, name: fullName(h), role: h.role }))}
            canWrite={canWrite}
          />
          <Card>
            <CardHeader title="Consent" />
            <CardBody className="flex flex-col gap-2 text-[13px]">
              {(
                [
                  ["Messages (SMS, email, WhatsApp)", m.consentMessaging && !m.dnd],
                  ["Photos in church media", m.consentPhoto],
                  ["Keeping health details", m.consentHealth],
                ] as const
              ).map(([label, yes]) => (
                <div key={label} className="flex items-center gap-2">
                  {yes ? <ShieldCheck className="size-4 text-good" /> : <ShieldOff className="size-4 text-faint" />}
                  <span className={yes ? "" : "text-muted"}>{label}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function ageOn(y: number, mo: number, d: number) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" }));
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) a--;
  return a;
}
