"use client";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { QrImage } from "@/components/qr";

/** The link members use to see their giving, send prayer requests and update their details. */
export function MemberPageCard({ url }: { url: string }) {
  return (
    <Card>
      <CardHeader title="Member page" />
      <CardBody className="flex items-center gap-4 max-sm:flex-col max-sm:items-start">
        <QrImage value={url} size={96} label="QR code for the member page" />
        <div className="flex min-w-0 flex-col gap-2 text-[13px]">
          <p className="text-muted">Members sign in with the phone number or email you have for them, then see their giving and statements, where they&apos;re serving, upcoming events, and send prayer requests. Share it in the bulletin and your WhatsApp groups.</p>
          <code className="truncate rounded bg-surface-2 px-2 py-1 font-mono text-xs" data-testid="member-page-link">
            {url}
          </code>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                navigator.clipboard.writeText(url).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Couldn't copy the link"),
                )
              }
            >
              <Copy /> Copy link
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={url} target="_blank" rel="noopener">
                <ExternalLink /> Open
              </a>
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
