import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, accentCss, accentTokens, contrast, DEFAULT_ACCENT } from "@/lib/color";

describe("church accent colours", () => {
  it("keeps readable contrast for any colour, in light and dark mode and in print", () => {
    for (const hex of [...ACCENT_PRESETS.map((p) => p.hex), "#ffd400", "#a3e635", "#111111", "#ffffff"]) {
      const t = accentTokens(hex);
      expect(contrast(t.light["--accent"], "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.light["--accent"], t.light["--accent-ink"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.dark["--accent"], "#0f1729")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.print, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("leaves well-behaved colours alone and writes nothing for the default", () => {
    expect(accentTokens("#6d28d9").light["--accent"]).toBe("#6d28d9");
    expect(accentCss(DEFAULT_ACCENT)).toBe("");
    expect(accentCss("not a colour")).toBe("");
    expect(accentCss("#9f1239")).toMatch(/^:root\{--accent:#9f1239;.*\}:root\.dark\{--accent:#[0-9a-f]{6};/);
  });
});
