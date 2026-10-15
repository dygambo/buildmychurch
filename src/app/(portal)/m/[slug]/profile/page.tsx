import { portalProfile } from "@/server/services/portal";
import { formatPhone } from "@/lib/phone";
import { formatDate } from "@/lib/format";
import { requireMember } from "../session";
import { ProfileForm } from "./form";

export default async function PortalProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { church, me } = await requireMember(slug);
  const p = await portalProfile(church, me);
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">My details</h1>
        <p className="text-[13px] text-muted">
          {p.name} · member since {formatDate(p.joinDate)}
        </p>
      </div>
      <ProfileForm slug={slug} p={{ ...p, phone: p.phone ? formatPhone(p.phone) : null }} />
    </>
  );
}
