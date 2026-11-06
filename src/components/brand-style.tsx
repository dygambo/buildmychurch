import { accentCss } from "@/lib/color";

/** Applies a church's accent colour to everything below it (light and dark mode). */
export function BrandStyle({ accent }: { accent: string | null | undefined }) {
  const css = accentCss(accent);
  if (!css) return null;
  return <style id="church-accent" dangerouslySetInnerHTML={{ __html: css }} />;
}

/** A church's logo (when it has one) and colour, for public pages that know which church they belong to. */
export async function ChurchBranding({ orgId, logo = false, className }: { orgId: string; logo?: boolean; className?: string }) {
  const { brandUrl, getBrand } = await import("@/server/services/brand");
  const b = await getBrand(orgId);
  const url = logo ? brandUrl(orgId, "logo", b) : null;
  return (
    <>
      <BrandStyle accent={b.accent} />
      {/* eslint-disable-next-line @next/next/no-img-element -- church logo from our own route */}
      {url && <img src={url} alt="" className={className ?? "mx-auto h-14 w-auto max-w-[180px] object-contain"} />}
    </>
  );
}
