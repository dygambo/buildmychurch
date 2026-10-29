import { redirect } from "next/navigation";
import { portalChurch, portalMember } from "@/server/services/portal";
import { SignInForm } from "./form";

export default async function PortalSignIn({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const church = (await portalChurch(slug))!;
  if (await portalMember(church)) redirect(`/m/${slug}`);
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 pt-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Welcome</h1>
        <p className="mt-1 text-[13px] text-muted">See your giving, download your statement, send prayer requests and keep your details up to date.</p>
      </div>
      <SignInForm slug={slug} />
      <p className="text-center text-xs text-faint">Use the phone number or email the church has for you. No password needed.</p>
    </div>
  );
}
