// Lightweight, dependency-free observability (H3). Structured error logging plus an optional
// fire-and-forget webhook (ERROR_WEBHOOK_URL) that works with Slack incoming webhooks or any
// JSON endpoint. For full Sentry, add @sentry/nextjs and call captureError from its handler too.
export function captureError(where: string, err: unknown, extra?: Record<string, unknown>): void {
  const e = err as Error;
  const payload = {
    level: "error" as const,
    where,
    message: e?.message ?? String(err),
    stack: e?.stack,
    ts: new Date().toISOString(),
    ...extra,
  };
  // Always log structured JSON — picked up by Vercel/any log drain.
  console.error(`[error] ${where}:`, JSON.stringify(payload));
  const url = process.env.ERROR_WEBHOOK_URL;
  if (url) {
    // `text` makes Slack incoming webhooks render; other fields are for custom sinks.
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `⚠️ ${where}: ${payload.message}`, ...payload }),
    }).catch(() => { /* never let telemetry break a request */ });
  }
}
