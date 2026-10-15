import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { portalChurch, portalMember } from "@/server/services/portal";
import { PortalNav } from "./nav";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await portalChurch((await params).slug);
  return { title: c ? `${c.name} · Member page` : "Member page", robots: { index: false } };
}

export default async function PortalLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const church = await portalChurch(slug);
  if (!church) notFound();
  const me = await portalMember(church);
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link href={`/m/${slug}`} className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{church.name}</div>
            <div className="text-xs text-muted">{me ? `${me.firstName} ${me.lastName} · ${me.memberNo}` : "Member page"}</div>
          </Link>
        </div>
        {me && <PortalNav slug={slug} />}
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5">{children}</main>
    </div>
  );
}
