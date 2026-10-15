import { describe, expect, it } from "vitest";
import { blindIndex, decrypt, encrypt } from "@/server/crypto";
import { base32Encode, totp, verifyTotp } from "@/server/auth/totp";
import { normalizeNgPhone, formatPhone, maskPhone } from "@/lib/phone";
import { passwordProblem } from "@/server/auth/password";
import { naira } from "@/lib/format";

describe("field encryption", () => {
  it("round-trips and never repeats ciphertext", () => {
    const a = encrypt("+2348031234567")!;
    const b = encrypt("+2348031234567")!;
    expect(a).not.toEqual(b);
    expect(decrypt(a)).toBe("+2348031234567");
  });
  it("detects tampering", () => {
    const c = encrypt("secret")!;
    const bad = c.slice(0, -2) + (c.endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(bad)).toThrow();
  });
  it("blind index is stable and case-insensitive", () => {
    expect(blindIndex("Ada@Example.com")).toBe(blindIndex("ada@example.com "));
    expect(blindIndex("a")).not.toBe(blindIndex("b"));
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 test secret "12345678901234567890"; reference 8-digit value at T=59s is 94287082.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC reference vector", () => {
    expect(totp(secret, 59_000)).toBe("287082");
    expect(totp(secret, 1111111109_000)).toBe("081804");
  });
  it("accepts one step of clock drift but not two", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
  });
});

describe("Nigerian phone numbers", () => {
  it.each([
    ["0803 123 4567", "+2348031234567"],
    ["+234 803 123 4567", "+2348031234567"],
    ["2349061234567", "+2349061234567"],
    ["07012345678", "+2347012345678"],
  ])("%s → %s", (i, o) => expect(normalizeNgPhone(i)).toBe(o));
  it("rejects bad numbers", () => {
    expect(normalizeNgPhone("0803123")).toBeNull();
    expect(normalizeNgPhone("05031234567")).toBeNull();
  });
  it("formats and masks", () => {
    expect(formatPhone("+2348031234567")).toBe("+234 803 123 4567");
    expect(maskPhone("+2348031234567")).toMatch(/4567$/);
  });
});

describe("passwords and money", () => {
  it("explains weak passwords", () => {
    expect(passwordProblem("short")).toMatch(/10 characters/);
    expect(passwordProblem("password12345")).toMatch(/guess/);
    expect(passwordProblem("Correct-Horse-Battery-9")).toBeNull();
  });
  it("formats naira from kobo", () => {
    expect(naira(125000000)).toBe("₦1,250,000");
    expect(naira(150)).toBe("₦1.50");
    expect(naira(4_500_000_000, { compact: true })).toBe("₦45m");
  });
});

import { firstName, initials } from "@/lib/format";
describe("names with church titles", () => {
  it.each([
    ["Pastor Ada Obi", "Ada", "AO"],
    ["Pst. Mrs. Grace Okafor", "Grace", "GO"],
    ["Rev. Dr. Effiong Bassey", "Effiong", "EB"],
    ["Deaconess Folake Ige", "Folake", "FI"],
    ["Chinedu Eze", "Chinedu", "CE"],
  ])("%s", (n, f, i) => {
    expect(firstName(n)).toBe(f);
    expect(initials(n)).toBe(i);
  });
});
