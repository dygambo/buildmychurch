"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Camera QR scanner. Uses the browser's built-in BarcodeDetector where available (Chrome, Android)
 * and falls back to jsQR elsewhere (iPhone Safari). Calls onScan once per distinct code.
 */
export function Scanner({ onScan, paused }: { onScan: (text: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const pausedRef = useRef(paused);
  const cb = useRef(onScan);
  useEffect(() => {
    pausedRef.current = paused;
    cb.current = onScan;
  });

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx2d = canvas.getContext("2d", { willReadFrequently: true })!;
    let detector: Detector | null = null;
    let jsqr: typeof import("jsqr").default | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        setError("We couldn't open the camera. Allow camera access in your browser, or search by name instead.");
        setOn(false);
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector })
        .BarcodeDetector;
      if (BD) detector = new BD({ formats: ["qr_code"] });
      else jsqr = (await import("jsqr")).default;

      const tick = async () => {
        if (stopped) return;
        if (!pausedRef.current && v.readyState >= 2) {
          let text: string | null = null;
          if (detector) {
            const r = await detector.detect(v).catch(() => []);
            text = r[0]?.rawValue ?? null;
          } else if (jsqr) {
            const w = (canvas.width = Math.min(640, v.videoWidth));
            const h = (canvas.height = Math.round((v.videoHeight / v.videoWidth) * w));
            ctx2d.drawImage(v, 0, 0, w, h);
            text = jsqr(ctx2d.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
          }
          const now = Date.now();
          if (text && (text !== last.current.text || now - last.current.at > 4000)) {
            last.current = { text, at: now };
            navigator.vibrate?.(60);
            cb.current(text);
          }
        }
        raf = requestAnimationFrame(() => void tick());
      };
      void tick();
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[#0b1220]">
        <video ref={video} playsInline muted className={`size-full object-cover ${on ? "" : "hidden"}`} />
        {on ? (
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,.35)]" />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-4 text-center text-[13px] text-white/70">
            <div className="flex flex-col items-center gap-2">
              <Camera className="size-8" />
              Point the camera at a child&apos;s QR tag
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <Button
        onClick={() => {
          setError(null);
          setOn((o) => !o);
        }}
        variant={on ? "secondary" : "primary"}
      >
        {on ? <CameraOff /> : <Camera />} {on ? "Stop camera" : "Start camera"}
      </Button>
    </div>
  );
}
