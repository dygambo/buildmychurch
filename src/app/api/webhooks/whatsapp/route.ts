import { env } from "@/server/env";
import { verifyMetaSignature } from "@/server/providers/messaging";
import { applyDeliveryReport } from "@/server/services/messaging";

/** Meta's one-time check that this URL belongs to us. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const token = env().WHATSAPP_VERIFY_TOKEN;
  if (token && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === token)
    return new Response(sp.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

type Payload = {
  entry?: {
    changes?: { value?: { statuses?: { id: string; status: string; errors?: { title?: string }[] }[] } }[];
  }[];
};

/** WhatsApp status updates (sent, delivered, read, failed), signed with the app secret. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  let body: Payload;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  for (const e of body.entry ?? [])
    for (const c of e.changes ?? [])
      for (const s of c.value?.statuses ?? []) {
        if (s.status === "delivered" || s.status === "read") await applyDeliveryReport(s.id, "delivered");
        else if (s.status === "failed") await applyDeliveryReport(s.id, "failed", s.errors?.[0]?.title ?? "WhatsApp couldn't deliver it");
      }
  return new Response("ok");
}
