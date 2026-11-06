"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ImageUp, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/ui/use-action";
import { ACCENT_PRESETS, accentCss, accentTokens, DEFAULT_ACCENT, isHex } from "@/lib/color";
import { cn } from "@/lib/utils";
import { removeBrandAction, setAccentAction, uploadBrandAction } from "./actions";

type Props = { churchName: string; logoUrl: string | null; faviconUrl: string | null; accent: string | null };

/** Shows the colour on this page straight away, before it's saved. */
function usePreview(hex: string) {
  useEffect(() => {
    let tag = document.getElementById("church-accent-preview") as HTMLStyleElement | null;
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "church-accent-preview";
      document.body.appendChild(tag);
    }
    tag.textContent = accentCss(hex, true);
    return () => tag?.remove();
  }, [hex]);
}

function ImageSlot({ kind, url, label, hint, square }: { kind: "logo" | "favicon"; url: string | null; label: string; hint: string; square?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const remove = useAction(removeBrandAction, { onSuccess: () => router.refresh() });
  const upload = (file: File) =>
    start(async () => {
      const f = new FormData();
      f.set("kind", kind);
      f.set("file", file);
      const r = await uploadBrandAction(f);
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex items-center gap-4">
      <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-white", square ? "size-16" : "h-16 w-32")}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview of the church's own upload
          <img src={url} alt={`${label} preview`} className="max-h-full max-w-full object-contain p-1.5" />
        ) : (
          <ImageUp className="size-5 text-faint" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="text-[13px] font-medium">{label}</div>
        <p className="text-xs text-faint">{hint}</p>
        <div className="flex gap-2">
          <input
            ref={input}
            type="file"
            accept={kind === "logo" ? "image/png,image/jpeg" : "image/png,image/jpeg,image/x-icon,.ico"}
            className="sr-only"
            aria-label={`Upload ${label.toLowerCase()}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <Button size="sm" loading={pending} onClick={() => input.current?.click()}>
            <ImageUp /> {url ? "Replace" : "Upload"}
          </Button>
          {url && (
            <Button size="sm" variant="ghost" loading={remove.pending} onClick={() => remove.run({ kind })}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function BrandingCard({ churchName, logoUrl, faviconUrl, accent }: Props) {
  const router = useRouter();
  const saved = accent ?? DEFAULT_ACCENT;
  const [hex, setHex] = useState(saved);
  const [typed, setTyped] = useState(saved);
  const dirty = hex.toLowerCase() !== saved.toLowerCase();
  usePreview(hex);
  const save = useAction(setAccentAction, { onSuccess: () => router.refresh() });
  const t = accentTokens(hex);
  const pick = (v: string) => {
    setHex(v);
    setTyped(v);
  };
  return (
    <Card>
      <CardHeader title="Branding" />
      <CardBody className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-6 max-md:grid-cols-1">
          <ImageSlot kind="logo" url={logoUrl} label="Church logo" hint="PNG or JPG, up to 2 MB. Shown in the app, on emails, service schedules, statements and memos." />
          <ImageSlot kind="favicon" url={faviconUrl} label="Browser icon" hint="A small square image (PNG, JPG or ICO). Shown in the browser tab." square />
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <div>
            <div className="text-[13px] font-medium">App colour</div>
            <p className="text-xs text-faint">Buttons, links and highlights across the app, member page, public pages, emails and PDFs. Everyone in your church sees it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="App colour">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={hex.toLowerCase() === c.hex}
                aria-label={c.name}
                title={c.name}
                onClick={() => pick(c.hex)}
                className="grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface transition aria-checked:ring-2 aria-checked:ring-fg"
                style={{ background: c.hex }}
              >
                {hex.toLowerCase() === c.hex && <Check className="size-4 text-white" />}
              </button>
            ))}
            <label className="ml-1 flex items-center gap-2 text-xs text-muted">
              <input type="color" value={hex} onChange={(e) => pick(e.target.value)} className="size-9 cursor-pointer rounded-full border border-line bg-transparent p-0.5" aria-label="Pick any colour" />
              <Input
                aria-label="Colour code"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  if (isHex(e.target.value)) setHex(e.target.value);
                }}
                className="w-28 font-mono"
                maxLength={7}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-4" data-testid="accent-preview">
            <span className="text-xs text-faint">Preview</span>
            <Button size="sm" variant="primary" tabIndex={-1}>
              Primary button
            </Button>
            <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">Badge</span>
            <a className="text-[13px] text-accent underline" tabIndex={-1}>
              A link
            </a>
            <span className="ml-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: t.print }}>
              {churchName} · emails and PDFs
            </span>
          </div>
          {t.light["--accent"] !== hex.toLowerCase() && <p className="text-xs text-faint">This colour is slightly darkened in the app so text on it stays easy to read.</p>}

          <div className="flex gap-2">
            <Button variant="primary" disabled={!dirty} loading={save.pending} onClick={() => save.run({ accent: hex.toLowerCase() === DEFAULT_ACCENT ? null : hex })}>
              Save colour
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => pick(saved)}>
                Cancel
              </Button>
            )}
            {!dirty && accent && (
              <Button variant="ghost" loading={save.pending} onClick={() => save.run({ accent: null })}>
                <RotateCcw /> Use the default colour
              </Button>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
