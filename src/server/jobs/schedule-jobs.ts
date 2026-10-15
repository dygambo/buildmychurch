import { registerJob } from "./registry";
import { completePastSchedules, generateVersionPdf, sendScheduleNotifications } from "../services/schedules";

/** Makes the PDF for a newly published version, then queues the notifications. */
registerJob("schedule.pdf", async (job) => {
  const { versionId, notify } = job.payload as { versionId: string; notify?: boolean };
  await generateVersionPdf(job.orgId!, versionId, { final: job.attempts >= job.maxAttempts, notify });
});

/** Emails (with the PDF) or texts the people whose part is new or changed. */
registerJob("schedule.notify", async (job) => {
  const { scheduleId, version } = job.payload as { scheduleId: string; version: number };
  await sendScheduleNotifications(job.orgId!, scheduleId, version);
});

registerJob("schedule.complete", async (job) => {
  await completePastSchedules(job.orgId!);
});
