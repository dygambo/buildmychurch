import { beforeEach, describe, expect, it } from "vitest";
import { withOrg } from "@/server/db";
import { addStaff, newChurch, resetDb } from "../helpers";
import { brandEmail, brandForPdf, brandImage, getBrand, removeBrandImage, setAccent, uploadBrandImage } from "@/server/services/brand";
import { emailLayout, p } from "@/server/emails/layout";

beforeEach(resetDb);

// a valid 1x1 PNG
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe("church branding", () => {
  it("stores a logo, favicon and colour, and uses them in emails and PDFs", async () => {
    const c = await newChurch("Light House Chapel");
    await expect(withOrg(c.orgId, (tx) => uploadBrandImage(tx, c.ctx, { kind: "logo", name: "logo.svg", bytes: SVG }))).rejects.toThrow(/PNG or JPG/);
    await withOrg(c.orgId, (tx) => uploadBrandImage(tx, c.ctx, { kind: "logo", name: "logo.png", bytes: PNG }));
    await withOrg(c.orgId, (tx) => uploadBrandImage(tx, c.ctx, { kind: "favicon", name: "icon.png", bytes: PNG }));
    await withOrg(c.orgId, (tx) => setAccent(tx, c.ctx, "#9f1239"));

    const b = await getBrand(c.orgId);
    expect(b).toMatchObject({ accent: "#9f1239" });
    expect(b.logoFileId).toBeTruthy();
    expect((await brandImage(c.orgId, "logo"))!.mime).toBe("image/png");
    expect((await brandImage(c.orgId, "favicon"))!.bytes.length).toBe(PNG.length);

    const html = await brandEmail(c.orgId, emailLayout({ church: "Light House Chapel", heading: "Hello", bodyHtml: p("Hi"), button: { label: "Open", url: "https://x" } }));
    expect(html).toContain(`/brand/${c.orgId}/logo?v=`);
    expect(html).toContain("#9f1239");
    expect(html).not.toContain("#2357e8");
    expect(await brandEmail(null, "<p>plain</p>")).toBe("<p>plain</p>");

    const pdf = await withOrg(c.orgId, (tx) => brandForPdf(tx, c.orgId));
    expect(pdf.logo!.length).toBe(PNG.length);
    expect(pdf.accent).toBe("#9f1239");

    await withOrg(c.orgId, (tx) => removeBrandImage(tx, c.ctx, "logo"));
    await withOrg(c.orgId, (tx) => setAccent(tx, c.ctx, null));
    expect(await brandImage(c.orgId, "logo")).toBeNull();
    const after = await brandEmail(c.orgId, emailLayout({ church: "X", heading: "Hi", bodyHtml: "" }));
    expect(after).not.toContain("/logo?v=");
    expect(after).toContain("#2357e8");
  });

  it("is only for people who can change church settings", async () => {
    const c = await newChurch();
    const fu = await addStaff(c.orgId, "followup");
    await expect(withOrg(c.orgId, (tx) => setAccent(tx, fu.ctx, "#15803d"))).rejects.toThrow();
    await expect(withOrg(c.orgId, (tx) => setAccent(tx, c.ctx, "red"))).rejects.toThrow(/colour/);
  });
});
