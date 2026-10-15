import { registerJob } from "./registry";
import { sendEmail } from "../providers/email";

/** Generic transactional email (password resets, invites). Payload is the full message. */
registerJob("email.send", async (job) => {
  const p = job.payload as { to: string; subject: string; html: string; text?: string };
  await sendEmail({ to: p.to, subject: p.subject, html: p.html, text: p.text });
});
