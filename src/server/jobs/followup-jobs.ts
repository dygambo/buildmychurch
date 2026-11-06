import { registerJob } from "./registry";
import { withOrg } from "../db";
import { openAbsenteeFollowups } from "../services/followup";

/** Weekly: opens follow-up for regular attenders who have missed three Sundays in a row. */
registerJob("followup.absentees", async (job) => {
  const orgId = job.orgId!;
  await withOrg(orgId, (tx) => openAbsenteeFollowups(tx, orgId));
});
