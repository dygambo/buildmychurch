// Recurring jobs are registered here as modules are added.
import { every } from "./scheduler";
import { purgeExpiredSessions } from "../auth/session";

every(60, async () => {
  await purgeExpiredSessions();
});
