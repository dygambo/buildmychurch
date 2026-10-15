import Link from "next/link";
import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-rail p-10 text-white lg:flex">
        <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold">
          <Logo className="size-9" /> Build My Church
        </Link>
        <div className="max-w-md">
          <p className="text-[28px] leading-tight font-semibold">
            Every member known. Every naira accounted for. Every first-timer followed up.
          </p>
          <ul className="mt-6 space-y-2.5 text-[14px] text-white/85">
            <li>Members, cells and departments across all your branches</li>
            <li>Tithes, offerings and Paystack giving with two-person verification</li>
            <li>Children's check-in with parent alerts, and E-Memo approvals</li>
          </ul>
        </div>
        <p className="text-xs text-white/60">
          Built for Nigerian churches. Your data is protected under the Nigeria Data Protection Act.
        </p>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full border-[48px] border-white/5"
        />
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="mb-8 flex items-center gap-2 font-semibold lg:hidden">
            <Logo className="size-8" /> Build My Church
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
