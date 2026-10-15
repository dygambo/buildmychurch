"use client";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/action";

/**
 * Runs a server action with pending state, field errors and toasts.
 * Prevents double submission: a second call while one is running is ignored.
 */
export function useAction<I, O>(
  action: (input: I) => Promise<ActionResult<O>>,
  opts: {
    success?: string | ((data: O) => string | undefined);
    onSuccess?: (data: O) => void;
    onError?: (error: string) => void;
  } = {},
) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { success, onSuccess, onError } = opts;

  const run = useCallback(
    (input: I) =>
      new Promise<ActionResult<O> | null>((resolve) => {
        if (pending) return resolve(null);
        startTransition(async () => {
          const r = await action(input);
          if (r.ok) {
            setFieldErrors({});
            const msg = r.message ?? (typeof success === "function" ? success(r.data) : success);
            if (msg) toast.success(msg);
            onSuccess?.(r.data);
          } else {
            setFieldErrors(r.fieldErrors ?? {});
            toast.error(r.error);
            onError?.(r.error);
          }
          resolve(r);
        });
      }),
    [action, pending, success, onSuccess, onError],
  );
  return { run, pending, fieldErrors, setFieldErrors };
}

/** FormData → plain object; checkboxes become booleans, repeated keys become arrays. */
export function formToObject(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fd = new FormData(form);
  for (const [k, v] of fd.entries()) {
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], v);
    else out[k] = v;
  }
  form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((cb) => {
    if (cb.dataset.multi) {
      if (!(cb.name in out)) out[cb.name] = [];
      else if (!Array.isArray(out[cb.name])) out[cb.name] = [out[cb.name]];
    } else out[cb.name] = cb.checked;
  });
  return out;
}
