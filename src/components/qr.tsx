"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

/** Renders a QR code as an image (works offline, prints crisply). */
export function QrImage({
  value,
  size = 200,
  className,
  label,
}: {
  value: string;
  size?: number;
  className?: string;
  label: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0e1a33", light: "#ffffff" },
    }).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [value, size]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt={label} className={cn("rounded-lg bg-white", className)} />
  ) : (
    <div
      style={{ width: size, height: size }}
      className={cn("animate-pulse rounded-lg bg-surface-3", className)}
      aria-label={label}
    />
  );
}
