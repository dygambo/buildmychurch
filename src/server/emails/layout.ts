const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Simple, well-tested email HTML (tables + inline styles) that renders in Gmail, Outlook and phones. */
export function emailLayout(o: {
  preheader?: string;
  heading: string;
  bodyHtml: string;
  button?: { label: string; url: string };
  footer?: string;
  church?: string;
}) {
  const brand = o.church ? esc(o.church) : "Build My Church";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0e1a33">
<span style="display:none;max-height:0;overflow:hidden">${esc(o.preheader ?? o.heading)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e7f0">
<tr><td style="background:#2357e8;color:#ffffff;padding:16px 24px;font-weight:600;font-size:15px">${brand}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${esc(o.heading)}</h1>
${o.bodyHtml}
${o.button ? `<p style="margin:22px 0 6px"><a href="${esc(o.button.url)}" style="display:inline-block;background:#2357e8;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px">${esc(o.button.label)}</a></p><p style="margin:8px 0 0;font-size:12px;color:#8792aa;word-break:break-all">Or paste this link into your browser: ${esc(o.button.url)}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e2e7f0;font-size:12px;color:#8792aa">${o.footer ? esc(o.footer) : "Sent by Build My Church on behalf of your church."}</td></tr>
</table></td></tr></table></body></html>`;
}

export const p = (s: string) => `<p style="margin:0 0 12px">${esc(s)}</p>`;
export { esc };
