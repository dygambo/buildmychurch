import { desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { devMailbox } from "@/server/db/schema";
import { env } from "@/server/env";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Development only: shows emails and SMS that would have been sent. Disabled in production. */
export default async function DevMailbox({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  if (process.env.NODE_ENV === "production" && env().EMAIL_PROVIDER !== "log") notFound();
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_MAILBOX !== "1") notFound();
  const { id } = await searchParams;
  const rows = await db.select().from(devMailbox).orderBy(desc(devMailbox.createdAt)).limit(100);
  const cur = rows.find((r) => r.id === id) ?? rows[0];
  return (
    <div className="grid h-dvh grid-cols-[360px_minmax(0,1fr)] max-md:grid-cols-1">
      <aside className="overflow-y-auto border-r border-line bg-surface">
        <h1 className="border-b border-line px-4 py-3 font-semibold">Development mailbox ({rows.length})</h1>
        {rows.map((r) => (
          <a
            key={r.id}
            href={`?id=${r.id}`}
            className={`block border-b border-line px-4 py-3 hover:bg-surface-2 ${cur?.id === r.id ? "bg-accent-soft" : ""}`}
          >
            <div className="truncate text-[13px] font-medium">{r.subject}</div>
            <div className="truncate text-xs text-faint">
              {r.channel.toUpperCase()} to {r.to} · {formatDateTime(r.createdAt)}
            </div>
          </a>
        ))}
      </aside>
      <section className="min-w-0 bg-white">
        {cur ? (
          cur.channel === "sms" ? (
            <pre className="p-6 whitespace-pre-wrap text-sm text-black">{cur.text}</pre>
          ) : (
            <iframe title={cur.subject} srcDoc={cur.html} sandbox="" className="h-full w-full" />
          )
        ) : (
          <p className="p-6 text-muted">No messages yet.</p>
        )}
      </section>
    </div>
  );
}
