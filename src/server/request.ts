import { headers } from "next/headers";

/** The visitor's IP address (from the proxy headers), for rate limiting. */
export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}
