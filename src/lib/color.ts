/** Colour helpers for church branding: turn one accent colour into the full set of tokens the app uses. */

export const DEFAULT_ACCENT = "#2357e8";

/** Suggested accents that work in light and dark mode. */
export const ACCENT_PRESETS = [
  { name: "Royal blue", hex: "#2357e8" },
  { name: "Purple", hex: "#6d28d9" },
  { name: "Wine", hex: "#9f1239" },
  { name: "Crimson", hex: "#c81e1e" },
  { name: "Burnt orange", hex: "#c2410c" },
  { name: "Forest green", hex: "#15803d" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Navy", hex: "#1e3a8a" },
] as const;

export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as RGB);
};

function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Darkens (or lightens) until text of `on` colour reads at the given contrast. */
function adjustFor(hex: string, on: string, target: number, toward: string) {
  let c = hex;
  for (let i = 0; i < 20 && contrast(c, on) < target; i++) c = mix(c, toward, 0.08);
  return c;
}

const LIGHT_BG = "#ffffff";
const DARK_BG = "#0f1729";
const DARK_INK = "#06102a";

/**
 * Light and dark token sets for one accent. The accent is nudged, never replaced, so it stays recognisably
 * the church's colour while buttons and links keep readable contrast (4.5:1 for text on white).
 */
export function accentTokens(input: string) {
  const base = isHex(input) ? input.toLowerCase() : DEFAULT_ACCENT;
  const light = adjustFor(base, LIGHT_BG, 4.5, "#000000");
  const lightInk = contrast(light, "#ffffff") >= 4.5 ? "#ffffff" : DARK_INK;
  const dark = adjustFor(mix(base, "#ffffff", 0.22), DARK_BG, 4.5, "#ffffff");
  const darkInk = contrast(dark, DARK_INK) >= contrast(dark, "#ffffff") ? DARK_INK : "#ffffff";
  return {
    light: {
      "--accent": light,
      "--accent-hover": mix(light, "#000000", 0.12),
      "--accent-ink": lightInk,
      "--accent-soft": mix(light, "#ffffff", 0.9),
      "--accent-line": mix(light, "#ffffff", 0.74),
      "--rail": adjustFor(mix(light, "#000000", 0.06), "#ffffff", 4.5, "#000000"),
    },
    dark: {
      "--accent": dark,
      "--accent-hover": mix(dark, "#ffffff", 0.14),
      "--accent-ink": darkInk,
      "--accent-soft": mix(dark, DARK_BG, 0.78),
      "--accent-line": mix(dark, DARK_BG, 0.55),
      "--rail": mix(base, DARK_BG, 0.6),
    },
    /** For emails and PDFs: white text on this colour always reads. */
    print: adjustFor(base, "#ffffff", 4.5, "#000000"),
  };
}

/** A <style> body that overrides the default accent for light and dark mode. */
export function accentCss(hex: string | null | undefined, force = false) {
  if (!isHex(hex) || (!force && hex.toLowerCase() === DEFAULT_ACCENT)) return "";
  const t = accentTokens(hex);
  const decl = (o: Record<string, string>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
  return `:root{${decl(t.light)}}:root.dark{${decl(t.dark)}}`;
}
