import type { JobRow } from "./queue";

export type JobHandler = (job: JobRow) => Promise<void>;
const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, fn: JobHandler) {
  handlers.set(type, fn);
}
export const getHandler = (type: string) => handlers.get(type);
