"use client";
import { useState } from "react";
import { ShieldCheck, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useAction, formToObject } from "@/components/ui/use-action";
import { formatPhone } from "@/lib/phone";
import { timeAgo } from "@/lib/format";
import { changePasswordAction, disableMfaAction, enableMfaAction, updateProfileAction } from "../actions";

type Props = {
  user: { name: string; email: string; phone: string; mfa: boolean; recoveryLeft: number };
  setup: { secret: string; qr: string } | null;
  sessions: { current: boolean; ua: string; ip: string; lastSeen: string }[];
};

const device = (ua: string) => {
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iPhone"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "Device";
  const br = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "Browser";
  return `${br} on ${os}`;
};

export function AccountView({ user, setup, sessions }: Props) {
  const profile = useAction(updateProfileAction);
  const pw = useAction(changePasswordAction);
  const [codes, setCodes] = useState<string[] | null>(null);
  const enable = useAction(enableMfaAction, { onSuccess: (d) => setCodes(d.codes) });
  const disable = useAction(disableMfaAction);
  return (
    <div className="grid grid-cols-2 items-start gap-[18px] max-lg:grid-cols-1">
      <div className="flex flex-col gap-[18px]">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                profile.run(formToObject(e.currentTarget) as { name: string; phone?: string });
              }}
            >
              <Field label="Full name" htmlFor="a-name" error={profile.fieldErrors.name}>
                <Input id="a-name" name="name" defaultValue={user.name} required />
              </Field>
              <Field label="Email" htmlFor="a-email" hint="Contact a Super Admin to change your sign-in email.">
                <Input id="a-email" value={user.email} readOnly className="text-faint" />
              </Field>
              <Field
                label="Phone"
                htmlFor="a-phone"
                error={profile.fieldErrors.phone}
                optional
                hint="Shown to parents on children's check-in notices."
              >
                <Input id="a-phone" name="phone" defaultValue={formatPhone(user.phone)} inputMode="tel" />
              </Field>
              <Button type="submit" variant="primary" className="justify-self-end" loading={profile.pending}>
                Save profile
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" />
          <CardBody>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                pw.run(formToObject(form) as { current: string; next: string }).then((r) => r?.ok && form.reset());
              }}
            >
              <Field label="Current password" htmlFor="p-cur" error={pw.fieldErrors.current}>
                <Input id="p-cur" name="current" type="password" autoComplete="current-password" required />
              </Field>
              <Field label="New password" htmlFor="p-next" error={pw.fieldErrors.next} hint="At least 10 characters.">
                <Input id="p-next" name="next" type="password" autoComplete="new-password" required minLength={10} />
              </Field>
              <Button type="submit" className="justify-self-end" loading={pw.pending}>
                Change password
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
      <div className="flex flex-col gap-[18px]">
        <Card>
          <CardHeader
            title="Two-step verification"
            action={
              user.mfa ? (
                <Badge tone="good">
                  <ShieldCheck /> On
                </Badge>
              ) : (
                <Badge tone="warn">Off</Badge>
              )
            }
          />
          <CardBody className="flex flex-col gap-3">
            {codes ? (
              <>
                <Note tone="good">
                  Two-step verification is on. Save these recovery codes somewhere safe. Each works once if you lose
                  your phone.
                </Note>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-3 font-mono text-[15px] tracking-wider">
                  {codes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </>
            ) : user.mfa ? (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  disable.run({ password: String(new FormData(e.currentTarget).get("password") ?? "") });
                }}
              >
                <p className="text-[13px] text-muted">
                  Your account asks for a code from your authenticator app at sign-in. {user.recoveryLeft} recovery
                  codes left.
                </p>
                <Field label="Confirm your password to turn it off" htmlFor="m-pw" error={disable.fieldErrors.password}>
                  <Input id="m-pw" name="password" type="password" required />
                </Field>
                <Button type="submit" variant="danger" className="justify-self-start" loading={disable.pending}>
                  Turn off two-step verification
                </Button>
              </form>
            ) : setup ? (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  enable.run({ secret: setup.secret, code: String(new FormData(e.currentTarget).get("code") ?? "") });
                }}
              >
                <p className="text-[13px] text-muted">
                  Required for finance and admin roles. Scan the code with Google Authenticator, Microsoft Authenticator
                  or Authy, then enter the 6-digit code it shows.
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={setup.qr}
                    alt="QR code for your authenticator app"
                    width={160}
                    height={160}
                    className="rounded-lg border border-line bg-white p-1"
                  />
                  <div className="min-w-0 flex-1 text-xs text-faint">
                    Can't scan? Enter this key manually:
                    <code className="mt-1 block font-mono text-[13px] break-all text-fg">
                      {setup.secret.match(/.{1,4}/g)?.join(" ")}
                    </code>
                  </div>
                </div>
                <Field label="6-digit code" htmlFor="m-code" error={enable.fieldErrors.code}>
                  <Input
                    id="m-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    className="font-mono tracking-[.3em]"
                  />
                </Field>
                <Button type="submit" variant="primary" className="justify-self-start" loading={enable.pending}>
                  <Smartphone /> Turn on
                </Button>
              </form>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Where you're signed in" />
          <CardBody className="flex flex-col divide-y divide-line">
            {sessions.map((s, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{device(s.ua)}</div>
                  <div className="text-xs text-faint">
                    {s.ip || "Unknown network"} · active {timeAgo(s.lastSeen)}
                  </div>
                </div>
                {s.current && <Badge tone="good">This device</Badge>}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
