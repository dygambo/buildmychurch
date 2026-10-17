import { termiiStatus, verifyTermiiSignature } from "@/server/providers/messaging";
import { applyDeliveryReport } from "@/server/services/messaging";

/** Termii delivery reports. Signed with HMAC-SHA512; unsigned or unknown reports are ignored. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyTermiiSignature(raw, req.headers.get("x-termii-signature"))) return new Response("Bad signature", { status: 401 });
  let body: { message_id?: string; id?: string; status?: string; notify_message?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const id = body.message_id ?? body.id;
  const status = termiiStatus(body.status);
  if (id && status) await applyDeliveryReport(String(id), status, body.notify_message ?? body.status);
  return new Response("ok");
}
