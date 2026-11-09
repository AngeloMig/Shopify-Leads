import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  outcomeKey,
  signTrackerBody,
  summarize,
  trackerConfigured,
} from "../server/lib/tracker-sync";
import type { Finding, PsiSample } from "../shared/types";

const runs = (performance: number): PsiSample[] =>
  (["mobile", "desktop"] as const).flatMap((strategy) =>
    [1, 2, 3].map((sample) => ({
      url: "https://store.example/",
      strategy,
      sample,
      tested_at: "2026-11-01T00:00:00Z",
      environment: {
        lighthouse_version: "12.0.0",
        form_factor: strategy,
        throttling_method: "simulate",
      },
      scores: {
        performance: strategy === "mobile" ? performance : 90,
        seo: 85,
        accessibility: 92,
      },
      diagnostics: {},
      field_data: { available: false, scope: "unavailable", metrics: {} },
    })),
  );
const finding = (
  title: string,
  kind: Finding["kind"] = "verified",
): Finding => ({
  id: title,
  category: "Performance",
  url: "https://store.example/",
  title,
  evidence: "Lighthouse mobile",
  severity: "high",
  confidence: "high",
  recommendation: "Fix it",
  kind,
});

describe("Tracker sync", () => {
  it("signs the timestamp and raw body the way the tracker checks them", () => {
    const body = JSON.stringify({ inquiry_id: "x" });
    expect(signTrackerBody("secret", "1762675200", body)).toBe(
      createHmac("sha256", "secret").update(`1762675200.${body}`).digest("hex"),
    );
  });
  it("stays off until both the tracker URL and the secret are set", () => {
    const { TRACKER_URL, SCOUT_SYNC_SECRET } = process.env;
    delete process.env.TRACKER_URL;
    process.env.SCOUT_SYNC_SECRET = "s";
    expect(trackerConfigured()).toBe(false);
    process.env.TRACKER_URL = "https://tracker.example";
    expect(trackerConfigured()).toBe(true);
    Object.assign(process.env, { TRACKER_URL, SCOUT_SYNC_SECRET });
    if (TRACKER_URL === undefined) delete process.env.TRACKER_URL;
    if (SCOUT_SYNC_SECRET === undefined) delete process.env.SCOUT_SYNC_SECRET;
  });
  it("summarizes scores and only verified findings, in plain words", () => {
    const s = summarize(
      runs(41),
      [
        finding("Reduce unused JavaScript"),
        finding("Checkout might lose customers", "hypothesis"),
      ],
      "2026-11-01T00:00:00Z",
    );
    expect([s.mobile, s.desktop, s.seo, s.accessibility]).toEqual([
      41, 90, 85, 92,
    ]);
    expect(s.findings).toEqual(["The page downloads code it doesn't use"]);
    expect(s.audited_at).toBe("2026-11-01T00:00:00Z");
  });
  it("leaves scores out when the runs can't be compared", () => {
    const s = summarize([], [], null);
    expect([s.mobile, s.desktop, s.seo, s.accessibility]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
  it("gives each settled attempt its own outcome, so a retry is posted again", () => {
    const blocked = {
      status: "blocked",
      started_at: "2026-11-09T13:54:59Z",
      completed_at: null,
    };
    expect(outcomeKey(blocked)).toBe("blocked@2026-11-09T13:54:59Z");
    expect(
      outcomeKey({ ...blocked, started_at: "2026-11-09T14:10:00Z" }),
    ).not.toBe(outcomeKey(blocked));
    expect(
      outcomeKey({
        status: "completed",
        started_at: "2026-11-09T14:10:00Z",
        completed_at: "2026-11-09T14:16:00Z",
      }),
    ).toBe("completed@2026-11-09T14:16:00Z");
  });
});
