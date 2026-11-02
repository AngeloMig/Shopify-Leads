/** Only read requests may be repeated: a failed response can follow a successful write. */
class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

const unavailable =
  "Cannot reach the Scout server right now. Please try again shortly.";

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown;
  let valid = false;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
      valid = true;
    } catch {
      // Proxies can return empty bodies or HTML while the API restarts.
    }
  }
  if (!response.ok) {
    const details =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    throw new ApiResponseError(
      typeof details.error === "string" && details.error.trim()
        ? details.error
        : response.status >= 500
          ? unavailable
          : `Request failed (HTTP ${response.status}). Please try again.`,
      response.status,
      typeof details.code === "string" ? details.code : undefined,
      [502, 503, 504].includes(response.status) ||
        (response.status === 500 && !valid),
    );
  }
  if (response.status === 204) return undefined as T;
  if (!valid)
    throw new ApiResponseError(
      "The Scout server returned an incomplete response. Please try again shortly.",
      response.status,
      undefined,
      true,
    );
  return data as T;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const attempts = (init.method ?? "GET").toUpperCase() === "GET" ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await readJson<T>(await fetch(url, init));
    } catch (cause) {
      if (
        init.signal?.aborted ||
        (cause instanceof Error && cause.name === "AbortError")
      )
        throw cause;
      const error =
        cause instanceof ApiResponseError
          ? cause
          : new ApiResponseError(unavailable, undefined, undefined, true);
      if (!error.retryable || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw new Error(unavailable);
}
