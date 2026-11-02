import { describe, it, expect, vi, afterEach } from "vitest";
import dns from "node:dns/promises";
import {
  publicAddress,
  normalizeDomain,
  validateTarget,
  safeFetch,
} from "../server/lib/network";
afterEach(() => vi.restoreAllMocks());
describe("SSRF boundary", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "224.0.0.1",
  ])("blocks nonpublic address %s", (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts public unicast %s",
    (ip) => expect(publicAddress(ip)).toBe(true),
  );
  it("canonicalizes duplicate domain forms", () => {
    expect(normalizeDomain("https://WWW.Example.com/products/a?x=1")).toBe(
      "example.com",
    );
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(() => normalizeDomain("https://user:pass@example.com")).toThrow();
  });
  it.each([
    "file:///etc/passwd",
    "http://localhost",
    "http://merchant.local",
    "http://merchant.internal",
    "https://example.com:8080/",
    "https://user:pass@example.com",
  ])("rejects unsafe URL %s", async (url) =>
    expect(validateTarget(url)).rejects.toThrow(),
  );
  it("rejects mixed public/private DNS answers", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    await expect(validateTarget("https://example.com")).rejects.toThrow(
      "Private or reserved",
    );
  });
  it("rejects a private target before opening a connection", async () => {
    await expect(safeFetch("http://127.0.0.1")).rejects.toThrow(
      "Private or reserved",
    );
  });
});
