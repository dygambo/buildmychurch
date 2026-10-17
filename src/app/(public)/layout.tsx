/** Pages people open from a QR code on their own phone: no sign-in, no app chrome. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col items-center bg-bg px-4 py-8">{children}</div>;
}
