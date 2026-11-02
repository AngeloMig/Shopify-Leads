import type {
  RunDetail,
  WorkEvent,
  JobWork,
  WorkStage,
} from "../../shared/job-activity";
import type { Job } from "../../shared/types";
import { inferTask, type TaskDescriptor } from "../../shared/research-tasks";
type PreviewStep = [
  WorkStage,
  WorkEvent["state"],
  string,
  Record<string, string | number | boolean | null>?,
  TaskDescriptor?,
];
const audit: PreviewStep[] = [
  [
    "verify",
    "started",
    "Connecting to the sample storefront",
    undefined,
    { key: "connect", name: "Connect to storefront", state: "starting" },
  ],
  [
    "verify",
    "note",
    "Waiting for the storefront response",
    undefined,
    { key: "connect", name: "Connect to storefront", state: "waiting" },
  ],
  [
    "verify",
    "note",
    "Storefront response received",
    { status_code: 200 },
    { key: "connect", name: "Connect to storefront", state: "completed" },
  ],
  [
    "verify",
    "started",
    "Checking public Shopify evidence",
    undefined,
    { key: "identify", name: "Identify storefront", state: "running" },
  ],
  [
    "verify",
    "completed",
    "Sample Shopify, activity and country checks passed",
    { shopify: true, country: "AU" },
    { key: "identify", name: "Identify storefront", state: "completed" },
  ],
  ...(
    [
      ["mobile", 1],
      ["desktop", 1],
      ["mobile", 2],
      ["mobile", 3],
      ["desktop", 2],
      ["desktop", 3],
    ] as const
  ).flatMap(([strategy, sample]): PreviewStep[] => [
    [
      "measure",
      "started",
      `Measuring ${strategy} performance — sample ${sample} of 3`,
      { strategy, sample },
    ],
    [
      "measure",
      "note",
      `Waiting for Google PageSpeed — ${strategy} sample ${sample} of 3`,
      { strategy, sample },
      {
        key: `${strategy}:${sample}`,
        name: `${strategy === "mobile" ? "Mobile" : "Desktop"} · sample ${sample} of 3`,
        state: "waiting",
      },
    ],
    [
      "measure",
      "note",
      `${strategy === "mobile" ? "Mobile" : "Desktop"} measurement received`,
      {
        strategy,
        sample,
        performance: strategy === "mobile" ? 45 + sample : 73 + sample,
        seo: strategy === "mobile" ? 82 : 89,
      },
      {
        key: `${strategy}:${sample}`,
        name: `${strategy === "mobile" ? "Mobile" : "Desktop"} · sample ${sample} of 3`,
        state: "completed",
      },
    ],
  ]),
  [
    "measure",
    "completed",
    "Six performance measurements saved",
    { measurements: 6 },
  ],
  ...(
    [
      ["product", "products/face-serum"],
      ["collection", "collections/skincare"],
      ["contact", "pages/contact"],
    ] as const
  ).flatMap(([kind, path]): PreviewStep[] => [
    [
      "inspect",
      "started",
      `Reading the ${kind} page`,
      { path },
      { key: `page:${path}`, name: `Review ${kind} page`, state: "waiting" },
    ],
    [
      "inspect",
      "note",
      `Reviewed the ${kind} page`,
      {
        path,
        status_code: 200,
        findings: kind === "product" ? 2 : 0,
        emails: kind === "contact" ? 1 : 0,
      },
      { key: `page:${path}`, name: `Review ${kind} page`, state: "completed" },
    ],
  ]),
  [
    "inspect",
    "completed",
    "Page observations and public contact saved",
    { pages: 4, findings: 2, emails: 1 },
  ],
  [
    "report",
    "started",
    "Collecting verified findings for the report",
    undefined,
    {
      key: "prepare",
      name: "Collect findings and recommendations",
      state: "running",
    },
  ],
  [
    "report",
    "note",
    "Verified findings collected",
    { findings: 2 },
    {
      key: "prepare",
      name: "Collect findings and recommendations",
      state: "completed",
    },
  ],
  [
    "report",
    "started",
    "Organizing sections and rendering the audit PDF",
    undefined,
    { key: "render", name: "Render audit PDF", state: "running" },
  ],
  [
    "report",
    "note",
    "Audit PDF rendered",
    undefined,
    { key: "render", name: "Render audit PDF", state: "completed" },
  ],
  [
    "report",
    "started",
    "Publishing the PDF to private storage",
    undefined,
    { key: "publish", name: "Publish private report", state: "waiting" },
  ],
  [
    "report",
    "completed",
    "Sample report ready to review",
    undefined,
    { key: "publish", name: "Publish private report", state: "completed" },
  ],
];
const discovery: typeof audit = [
  ["prepare", "started", "Loading the sample Australian skincare campaign"],
  [
    "prepare",
    "completed",
    "Sample campaign ready · 3-store target · 1-search limit",
  ],
  [
    "search",
    "started",
    "Searching for independent skincare stores",
    { query: "botanical skincare online shop Australia", country: "AU" },
  ],
  [
    "search",
    "completed",
    "20 sample candidates saved for review",
    { returned: 20, candidates: 20 },
  ],
  ["verify", "started", "Checking atelier-botanics.example"],
  [
    "queue",
    "note",
    "atelier-botanics.example passed sample verification",
    { outcome: "queued", country: "AU" },
  ],
  ["verify", "started", "Checking field-and-form.example"],
  [
    "verify",
    "note",
    "Sample candidate set aside; country needs review",
    { outcome: "review" },
  ],
  ["verify", "started", "Checking luma-skin.example"],
  [
    "queue",
    "note",
    "luma-skin.example passed sample verification",
    { outcome: "queued", country: "AU" },
  ],
  [
    "verify",
    "completed",
    "Sample storefront checks finished",
    { checked: 3, shopify: 3, country: 2 },
  ],
  [
    "queue",
    "completed",
    "2 sample stores queued; 17 unchecked candidates retained",
    { queued: 2, saved: 0, search_requests: 1 },
  ],
];
export const previewLength = (type: Job["type"]) =>
  (type === "audit" ? audit : discovery).length;
export function previewRun(
  type: Job["type"],
  index: number,
  base: number,
): RunDetail {
  const steps = type === "audit" ? audit : discovery,
    step = Math.min(index, steps.length - 1),
    done = step === steps.length - 1;
  const url = "https://atelier-botanics.example/";
  const events: WorkEvent[] = steps
    .slice(0, step + 1)
    .map(([stage, state, message, facts, explicit], i) => {
      const task =
        explicit ??
        inferTask({
          stage,
          state,
          message,
          facts,
          url: type === "audit" ? url : undefined,
        });
      return {
        id: `preview-${type}-${i}`,
        attempt: 1,
        at: new Date(base + i * 2500).toISOString(),
        stage,
        state,
        message,
        facts,
        url:
          type === "audit"
            ? typeof facts?.path === "string"
              ? `${url}${facts.path}`
              : url
            : undefined,
        task_id: `preview-${type}:1:${stage}:${task.key}`,
        parent_id: stage,
        task_name: task.name,
        task_state: task.state,
      };
    });
  const target =
    type === "audit"
      ? { label: "Atelier Botanics", domain: "atelier-botanics.example", url }
      : {
          label: "Australian skincare · sample campaign",
          domain:
            step >= 8
              ? "luma-skin.example"
              : step >= 6
                ? "field-and-form.example"
                : step >= 4
                  ? "atelier-botanics.example"
                  : undefined,
        };
  const work: JobWork = {
    version: 1,
    target,
    stage: steps[step][0],
    updated_at: events.at(-1)!.at,
    events,
  };
  const inspected = events.some(
    (e) => e.stage === "inspect" && e.state === "completed",
  );
  const measurements: RunDetail["measurements"] =
    type === "audit"
      ? events
          .filter((e) => typeof e.facts?.performance === "number")
          .map((e) => ({
            strategy: String(e.facts!.strategy),
            sample: Number(e.facts!.sample),
            tested_at: e.at,
            scores: {
              performance: Number(e.facts!.performance),
              seo: Number(e.facts!.seo),
            },
          }))
      : [];
  return {
    job: {
      id: `preview-${type}`,
      type,
      status: done ? "completed" : "running",
      available_at: new Date(base).toISOString(),
      progress: Math.round(((step + 1) / steps.length) * 100),
      created_at: new Date(base).toISOString(),
      started_at: new Date(base).toISOString(),
      completed_at: done ? events.at(-1)!.at : null,
      error: null,
      attempts: 1,
      max_attempts: 3,
      api_usage: {},
      payload: {
        work,
        ...(type === "discovery"
          ? {
              funnel: {
                returned: step >= 3 ? 20 : 0,
                checked: step >= 10 ? 3 : step >= 4 ? 1 : 0,
                shopify: step >= 10 ? 3 : 0,
                country: step >= 10 ? 2 : 0,
                queued: done ? 2 : step >= 5 ? 1 : 0,
                saved_used: 0,
              },
            }
          : {}),
      },
    },
    target,
    server_time: events.at(-1)!.at,
    pages: inspected
      ? [
          { url, kind: "homepage", status_code: 200 },
          {
            url: `${url}products/face-serum`,
            kind: "product",
            status_code: 200,
          },
          {
            url: `${url}collections/skincare`,
            kind: "collection",
            status_code: 200,
          },
          { url: `${url}pages/contact`, kind: "contact", status_code: 200 },
        ]
      : [],
    measurements,
    findings: inspected
      ? [
          {
            title: "Sample: large product images delay loading",
            category: "Images",
            severity: "medium",
            url,
          },
          {
            title: "Sample: some text needs stronger contrast",
            category: "Accessibility",
            severity: "medium",
            url,
          },
        ]
      : [],
    report_id: done && type === "audit" ? "sample-report" : null,
  };
}
