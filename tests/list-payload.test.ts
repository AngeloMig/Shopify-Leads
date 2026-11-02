import { describe, expect, it } from "vitest";
import {
  listWork,
  readWork,
  stageState,
  stagesFor,
  targetFor,
} from "../shared/job-activity";
import {
  hasFrontendOpportunity,
  leadIntelligence,
} from "../shared/lead-intelligence";
import { leadScoreFor } from "../shared/lead-score";
import type { Finding, Job, Lead } from "../shared/types";

const finding = (patch: Partial<Finding>): Finding => ({
  id: "f1",
  category: "Frontend",
  url: "https://example.com/",
  title: "Reduce unused JavaScript",
  evidence: `Lighthouse mobile unused-javascript: ${JSON.stringify({ items: [{ nodeLabel: "A button" }] })}`,
  severity: "medium",
  confidence: "high",
  recommendation: "Remove unused code.",
  kind: "verified",
  ...patch,
});
const lead = (findings: Finding[], patch: Partial<Lead> = {}): Lead => ({
  id: "l1",
  store_id: "s1",
  domain: "example.com",
  name: "Example",
  country: "US",
  country_evidence: "Observed address",
  industry: "Other",
  activity: 60,
  seo: 80,
  performance: 62,
  desktop: 80,
  modernization: 50,
  cro: 40,
  priority: 0,
  stage: "new",
  audited_at: "2026-11-01T00:00:00.000Z",
  shopify_verified: true,
  findings,
  notes: "",
  owner: "",
  emails: [{ email: "hello@example.com", source_url: "https://example.com/" }],
  permission: "unknown",
  suppressed: false,
  ...patch,
});
// What loadLeads sends lists: the same findings with their long text left out.
const summarized = (findings: Finding[]) =>
  findings.map((f) => ({ ...f, url: "", evidence: "", recommendation: "" }));
const sets: [string, Finding[], Partial<Lead>?][] = [
  ["no findings", []],
  ["a slow store", [finding({})]],
  ["a fast store", [finding({})], { performance: 95 }],
  [
    "a high-severity defect",
    [
      finding({
        id: "a",
        category: "SEO",
        title: "Missing H1",
        severity: "high",
        evidence: "No h1 on the page.",
      }),
      finding({
        id: "b",
        title: "Images without alt text",
        category: "Images",
        evidence: "3/9 images have no alt attribute: https://example.com/a.png",
      }),
    ],
    { performance: 90 },
  ],
  [
    "unverified ideas only",
    [
      finding({
        id: "c",
        kind: "hypothesis",
        category: "CRO",
        title: "Sticky cart",
      }),
      finding({
        id: "d",
        kind: "idea",
        category: "CRO",
        title: "Bundle offer",
      }),
    ],
  ],
  ["a suppressed store", [finding({})], { suppressed: true }],
];
describe("lead lists without evidence text", () => {
  it.each(sets)(
    "shows the same labels and scores for %s",
    (_name, findings, patch) => {
      const full = lead(findings, patch),
        list = lead(summarized(findings), patch);
      const { issues: _fullIssues, ...fromFull } = leadIntelligence(full, 0);
      const { issues: _listIssues, ...fromList } = leadIntelligence(list, 0);
      expect(fromList).toEqual(fromFull);
      expect(leadScoreFor(list)).toEqual(leadScoreFor(full));
      expect(hasFrontendOpportunity(list)).toBe(hasFrontendOpportunity(full));
    },
  );
});

const event = (id: string, stage: string, patch = {}) => ({
  id,
  at: "2026-11-01T00:00:00.000Z",
  attempt: 2,
  stage,
  state: "completed",
  message: id,
  ...patch,
});
const work = {
  version: 1,
  stage: "inspect",
  updated_at: "2026-11-01T00:00:00.000Z",
  target: { label: "Example", domain: "example.com" },
  events: [
    event("old-attempt", "report", { attempt: 1 }),
    event("verify-1", "verify", { state: "started" }),
    event("verify-2", "verify"),
    event("measure-skip", "measure", { state: "skipped" }),
    event("measure-task", "measure", { scope: "task", task_id: "t" }),
    event("inspect-start", "inspect", { state: "started" }),
    event("inspect-task", "inspect", {
      scope: "task",
      task_id: "t",
      message: "Newest update",
    }),
  ],
};
const job = (payloadWork: unknown, status: Job["status"] = "running"): Job => ({
  id: "j1",
  type: "audit",
  status,
  progress: 50,
  created_at: "2026-11-01T00:00:00.000Z",
  started_at: null,
  completed_at: null,
  error: null,
  attempts: 2,
  max_attempts: 3,
  payload: { work: payloadWork },
  api_usage: {},
});
describe("job lists", () => {
  const listed = listWork(work, 2);
  it("keeps only the events a list reads", () => {
    expect(listed?.events.map((e) => e.id)).toEqual([
      "verify-2",
      "measure-skip",
      "inspect-start",
      "inspect-task",
    ]);
  });
  it.each(["running", "completed", "failed", "cancelled"] as const)(
    "shows the same stages, target and latest update for a %s job",
    (status) => {
      const full = job(work, status),
        list = job(listed, status);
      for (const stage of stagesFor("audit"))
        expect(stageState(list, stage)).toBe(stageState(full, stage));
      expect(targetFor(list)).toEqual(targetFor(full));
      expect(readWork(list.payload.work)?.events.at(-1)?.message).toBe(
        "Newest update",
      );
    },
  );
  it("treats a finished job's event-free summary as valid work", () => {
    const summary = listWork({ ...work, events: [] }, 2);
    expect(targetFor(job(summary, "completed"))).toEqual(
      targetFor(job(work, "completed")),
    );
  });
  it("falls back like readWork when a job has no usable work", () => {
    expect(listWork(undefined, 1)).toBeNull();
    expect(
      listWork({ version: undefined, target: undefined, events: [] }, 1),
    ).toBeNull();
  });
});
