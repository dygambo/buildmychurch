import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format";
import { myPrayer } from "@/server/services/portal";
import { requireMember } from "../session";
import { PortalPrayerForm } from "./form";

const ST = { new: { label: "Received", tone: "accent" }, praying: { label: "Being prayed for", tone: "purple" }, answered: { label: "Answered", tone: "good" }, closed: { label: "Closed", tone: "neutral" } } as const;

export default async function PortalPrayer({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { church, me } = await requireMember(slug);
  const list = await myPrayer(church, me);
  return (
    <>
      <h1 className="text-xl font-semibold">Prayer</h1>
      <PortalPrayerForm slug={slug} />
      <Card>
        <CardHeader title="Your requests" />
        {list.length === 0 ? (
          <EmptyState title="Nothing yet">Requests you send appear here, with how the prayer team is getting on.</EmptyState>
        ) : (
          <ul className="flex flex-col" data-testid="my-prayer">
            {list.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 border-t border-line px-4 py-3 first:border-t-0">
                <div className="flex items-center gap-2 text-xs text-faint">
                  <Badge tone={ST[r.status].tone}>{ST[r.status].label}</Badge>
                  {r.prayedCount > 0 && <span>Prayed for {r.prayedCount}×</span>}
                  <span className="ml-auto">{timeAgo(r.createdAt)}</span>
                </div>
                <p className="text-[14px] whitespace-pre-wrap">{r.body}</p>
                {r.testimony && <p className="text-[13px] text-good">Testimony: {r.testimony}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
