import { describe, expect, it } from "vitest";
import { buckets, change, resolvePeriod } from "@/lib/periods";

describe("report periods", () => {
  it("resolves presets in Lagos dates with a matching previous period", () => {
    const m = resolvePeriod({ period: "month" }, "2026-10-15");
    expect(m).toMatchObject({ from: "2026-10-01", to: "2026-10-15", prevFrom: "2026-09-16", prevTo: "2026-09-30", bucket: "week" });
    const lm = resolvePeriod({ period: "last_month" }, "2026-03-10");
    expect(lm).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolvePeriod({ period: "quarter" }, "2026-08-20").from).toBe("2026-07-01");
    expect(resolvePeriod({ period: "last_year" }, "2026-01-05")).toMatchObject({ from: "2025-01-01", to: "2025-12-31", bucket: "month" });
    expect(resolvePeriod({}, "2026-10-15")).toMatchObject({ preset: "12m", from: "2025-11-01", to: "2026-10-15" });
  });

  it("rejects bad custom ranges and falls back to the last 12 months", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-05-01", to: "2026-04-01" }, "2026-10-15").preset).toBe("12m");
    expect(resolvePeriod({ period: "custom", from: "2020-01-01", to: "2026-01-01" }, "2026-10-15").preset).toBe("12m");
    expect(resolvePeriod({ period: "custom", from: "2026-04-01", to: "2026-04-30" }, "2026-10-15")).toMatchObject({ preset: "custom", bucket: "week" });
  });

  it("lists every bucket so empty weeks and months show as zero", () => {
    const months = buckets({ from: "2025-11-01", to: "2026-10-15", bucket: "month" });
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ key: "2025-11-01", label: "Nov 25" });
    expect(months[2]!.label).toBe("Jan 26");
    const weeks = buckets({ from: "2026-10-01", to: "2026-10-15", bucket: "week" });
    expect(weeks.map((w) => w.key)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
  });

  it("computes change only when there is something to compare", () => {
    expect(change(120, 100)).toBe(20);
    expect(change(5, 0)).toBeNull();
  });
});
