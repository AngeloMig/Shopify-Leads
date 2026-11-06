export class JobError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "JobError";
  }
}
export function retryAfter(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now;
  return Number.isFinite(delay)
    ? Math.max(1000, Math.min(7 * 86400000, delay))
    : undefined;
}
export function providerName(url: string) {
  const host = new URL(url).hostname;
  return host === "api.geoapify.com"
    ? "geoapify"
    : host.includes("googleapis")
      ? "pagespeed"
      : host.includes("tavily")
        ? "tavily"
        : host.includes("brave")
          ? "brave"
          : host.includes("storeleads")
            ? "storeleads"
            : host.includes("openai")
              ? "openai"
              : "provider";
}
export function classifyJobError(error: unknown) {
  if (error instanceof JobError) return error;
  const message = error instanceof Error ? error.message : "Job failed";
  const provider = /TAVILY/.test(message)
    ? "tavily"
    : /PAGESPEED/.test(message)
      ? "pagespeed"
      : /BRAVE/.test(message)
        ? "brave"
        : /STORE_LEADS/.test(message)
          ? "storeleads"
          : /OPENAI/.test(message)
            ? "openai"
            : undefined;
  const code = /Daily API request budget exhausted/i.test(message)
    ? "budget"
    : /Provider paused/i.test(message)
      ? "provider_paused"
      : /not configured|API key|requires .*API_KEY|BRAVE_STORAGE_ALLOWED|credentials|account access|storage.*allowed/i.test(
            message,
          )
        ? "credentials"
        : /disallowed by robots|Robots rules unavailable \((401|403)\)|crawl delay exceeds|Homepage.*\((401|403)\)|HTTP (401|403)/i.test(
              message,
            )
          ? "crawl_blocked"
          : /suppressed|Unsafe target|Private.*blocked|public HTTP|Too many redirects/i.test(
                message,
              )
            ? "invalid_target"
            : /lease lost|not running/i.test(message)
              ? "lease_lost"
              : /\b(404|410)\b|different final URLs|different.*environments/i.test(
                    message,
                  )
                ? "permanent"
                : "temporary";
  return new JobError(message, code, provider);
}
export function failureDecision(
  error: unknown,
  attempts: number,
  maxAttempts: number,
  now = Date.now(),
  random = Math.random,
) {
  const e = classifyJobError(error);
  if (e.code === "lease_lost")
    return {
      error: e,
      status: "lost" as const,
      restoreAttempt: false,
      availableAt: new Date(now).toISOString(),
    };
  const blocked = [
    "credentials",
    "crawl_blocked",
    "invalid_target",
    "permanent",
    "provider_paused",
    "search_limit",
  ].includes(e.code);
  const budget = e.code === "budget";
  const status = blocked
    ? "blocked"
    : budget || attempts < maxAttempts
      ? "queued"
      : "failed";
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  const delay =
    e.retryAfterMs ??
    Math.min(3600000, 30000 * 2 ** Math.max(0, attempts - 1)) *
      (0.75 + random() * 0.5);
  return {
    error: e,
    status: status as "blocked" | "queued" | "failed",
    restoreAttempt: budget || e.code === "provider_paused",
    availableAt: budget
      ? next.toISOString()
      : new Date(now + delay).toISOString(),
  };
}
