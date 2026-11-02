import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "../src/api-request";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mockFetch() {
  vi.useFakeTimers();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("API response recovery", () => {
  it.each([
    [500, ""],
    [502, "<html>Bad gateway</html>"],
    [200, '{"jobs":'],
    [200, ""],
  ])(
    "recovers a GET after HTTP %s with an incomplete response",
    async (status, body) => {
      const fetcher = mockFetch()
        .mockResolvedValueOnce(new Response(body, { status }))
        .mockResolvedValueOnce(Response.json({ jobs: ["saved-job"] }));
      const result = requestJson("/api/snapshot");
      await vi.runAllTimersAsync();
      await expect(result).resolves.toEqual({ jobs: ["saved-job"] });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("bounds repeated gateway failures and displays a connection message instead of a JSON parser error", async () => {
    const fetcher = mockFetch().mockImplementation(() =>
      Promise.resolve(new Response("", { status: 503 })),
    );
    const result = expect(requestJson("/api/snapshot")).rejects.toThrow(
      "Cannot reach the Scout server",
    );
    await vi.runAllTimersAsync();
    await result;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("recovers a temporary network failure", async () => {
    const fetcher = mockFetch()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const result = requestJson("/api/snapshot");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["POST", "PATCH", "DELETE"])(
    "never automatically repeats a %s after a failed response",
    async (method) => {
      const fetcher = mockFetch().mockResolvedValue(
        new Response("", { status: 502 }),
      );
      await expect(requestJson("/api/jobs", { method })).rejects.toThrow(
        "Cannot reach the Scout server",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves workspace/authentication error codes without retrying", async () => {
    const fetcher = mockFetch().mockResolvedValue(
      Response.json(
        { error: "Choose a workspace", code: "NO_WORKSPACE" },
        { status: 403 },
      ),
    );
    await expect(requestJson("/api/snapshot")).rejects.toMatchObject({
      message: "Choose a workspace",
      status: 403,
      code: "NO_WORKSPACE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not show HTML proxy errors or retry non-transient failures", async () => {
    const fetcher = mockFetch().mockResolvedValue(
      new Response("<html>private server details</html>", { status: 404 }),
    );
    await expect(requestJson("/api/snapshot")).rejects.toThrow(
      "Request failed (HTTP 404)",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts an intentional no-content response", async () => {
    mockFetch().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      requestJson("/api/jobs", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });
});
