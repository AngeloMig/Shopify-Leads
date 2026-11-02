import {
  publicActivityUrl,
  readWork,
  type RunDetail,
  type WorkStage,
} from "../../shared/job-activity";

export type NetworkStage = {
  id: WorkStage;
  label: string;
  state: string;
  detail: string;
};
export type NetworkPoint = [number, number, number];
/** A past run as drawn on the run-history star map. */
export type RunStar = {
  id: string;
  label: string;
  kind: "audit" | "discovery";
  status: string;
  /** Stores queued for audit; sets how bright the constellation burns. */
  leads: number;
};
export const clusterCenters: NetworkPoint[] = [
  [-1.8, 0.95, 0.25],
  [-1.8, -0.95, 0.25],
  [1.8, 0.95, 0.25],
  [1.8, -0.95, 0.25],
];
export const stageNames: Record<WorkStage, string> = {
  prepare: "Campaign",
  search: "Discover",
  verify: "Verify",
  queue: "Queue",
  measure: "PageSpeed",
  inspect: "Inspect",
  report: "Report",
};
export type ResearchEvidence = {
  counts: { label: string; value: number | null }[];
  cards: { url: string; label: string; kind: string }[];
  scores: Record<string, number | null>;
  scoreLabel: string;
};
export function researchEvidence(
  detail: RunDetail | null,
  kind: "audit" | "discovery",
): ResearchEvidence {
  const validCount = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
  const funnel = detail?.job.payload.funnel as
    | Record<string, unknown>
    | undefined;
  const counts =
    kind === "discovery"
      ? [
          { label: "Search results", value: validCount(funnel?.returned) },
          { label: "Checked", value: validCount(funnel?.checked) },
          { label: "Audits queued", value: validCount(funnel?.queued) },
        ]
      : [
          {
            label: "Measurements",
            value: detail ? detail.measurements.length : null,
          },
          {
            label: "Pages recorded",
            value: detail ? detail.pages.length : null,
          },
          {
            label: "Findings shown",
            value: detail ? detail.findings.length : null,
          },
        ];
  const latest = detail?.measurements
    .filter((m) => m.strategy === "mobile")
    .sort((a, b) => a.sample - b.sample)
    .at(-1);
  const records =
    kind === "audit"
      ? (detail?.pages.map((p) => ({ url: p.url, kind: p.kind })) ?? [])
      : (readWork(detail?.job.payload.work)?.events ?? [])
          .filter((e) => e.stage === "verify" && e.url)
          .map((e) => ({ url: e.url!, kind: "Candidate checked" }));
  const cards: ResearchEvidence["cards"] = [];
  for (const record of records) {
    const url = publicActivityUrl(record.url);
    if (!url || cards.some((c) => c.url === url)) continue;
    const parsed = new URL(url);
    cards.push({
      url,
      kind: record.kind,
      label:
        kind === "audit"
          ? parsed.pathname
          : parsed.hostname.replace(/^www\./, ""),
    });
  }
  return {
    counts,
    cards: cards.slice(0, 6),
    scores: latest?.scores ?? {},
    scoreLabel: latest
      ? `Mobile · sample ${latest.sample} of 3`
      : "No mobile measurement recorded",
  };
}
export const networkColors = {
  active: "#a2ffe2",
  completed: "#61cfb6",
  attention: "#f1be72",
  recorded: "#8abcc6",
  pending: "#426973",
};
export function nodeColor(state: string, selected: boolean) {
  return selected
    ? "#e5fff5"
    : state === "active"
      ? networkColors.active
      : state === "completed"
        ? networkColors.completed
        : state === "attention" || state === "cancelled"
          ? networkColors.attention
          : state === "recorded"
            ? networkColors.recorded
            : networkColors.pending;
}
/** A bounded visual mesh. Worker tasks and their stable identities are drawn separately. */
export const neuralDensities = [2000, 5000, 10000] as const;
/** Ten stable size tiers, weighted toward fine neurons rather than bright hubs. */
export const neuronSizeTiers = [
  { size: 1.5, weight: 38 },
  { size: 1.9, weight: 24 },
  { size: 2.4, weight: 15 },
  { size: 3.0, weight: 9 },
  { size: 3.8, weight: 5.5 },
  { size: 4.7, weight: 3.5 },
  { size: 5.8, weight: 2.2 },
  { size: 7.1, weight: 1.4 },
  { size: 8.6, weight: 0.9 },
  { size: 10.4, weight: 0.5 },
] as const;
function neuronSize(index: number) {
  // Integer hashing gives a scattered distribution without changing on render,
  // camera movement, or density switching. This is visual variety, not evidence.
  let hash = index + 0x9e3779b9;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  const roll = (((hash ^ (hash >>> 15)) >>> 0) / 4294967296) * 100;
  let threshold = 0;
  for (const tier of neuronSizeTiers) {
    threshold += tier.weight;
    if (roll < threshold) return tier.size;
  }
  return neuronSizeTiers[0].size;
}

export function buildNetwork(neuronCount: number = 10000) {
  const total = Number.isFinite(neuronCount)
    ? Math.max(8, Math.min(10000, Math.round(neuronCount)))
    : 10000;
  const points: {
    position: NetworkPoint;
    cluster: number;
    anchor: boolean;
    size: number;
  }[] = clusterCenters.map((position, cluster) => ({
    position,
    cluster,
    anchor: true,
    size: neuronSize(cluster),
  }));
  const tissueCount = total - 4;
  for (let i = 0; i < tissueCount; i++) {
    const x = (((i + 0.5) / tissueCount) * 2 - 1) * 3.15;
    const angle = i * 2.39996323;
    const radius = Math.sqrt(1 - (x / 3.25) ** 2);
    const shell = i % 4 === 0 ? 0.58 : 1;
    const fold = 1 + 0.09 * Math.sin(angle * 4 + x * 2);
    const y = Math.sin(angle) * radius * 1.8 * shell * fold;
    const z = Math.cos(angle) * radius * 1.45 * shell;
    const position: NetworkPoint = [x + (x < 0 ? -0.09 : 0.09), y, z];
    points.push({
      position,
      cluster: (x < 0 ? 0 : 2) + (y < 0 ? 1 : 0),
      anchor: false,
      size: neuronSize(i + 4),
    });
  }
  const edges: {
    from: NetworkPoint;
    to: NetworkPoint;
    cluster: number;
    a: number;
    b: number;
  }[] = [];
  const seen = new Set<number>();
  const connect = (a: number, b: number) => {
    if (a === b) return;
    const key = Math.min(a, b) * total + Math.max(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      from: points[a].position,
      to: points[b].position,
      cluster: points[a].cluster,
      a,
      b,
    });
  };
  // Nearby cells replace N squared distance comparisons and sorts. At full density
  // a cell is about three times the typical neuron spacing on the folded shell.
  const cellSize = Math.max(0.28, 0.28 * Math.sqrt(10000 / total));
  const cell = (position: NetworkPoint) =>
    position.map((v) => Math.floor(v / cellSize));
  const key = (x: number, y: number, z: number) =>
    ((x + 32) * 64 + y + 32) * 64 + z + 32;
  const cells = new Map<number, number[]>();
  points.forEach((point, i) => {
    const [x, y, z] = cell(point.position),
      id = key(x, y, z);
    const bucket = cells.get(id);
    if (bucket) bucket.push(i);
    else cells.set(id, [i]);
  });
  points.forEach((point, a) => {
    const [cx, cy, cz] = cell(point.position);
    const candidates: { b: number; d: number }[] = [];
    // Only visit each shell once; even sparse anchor positions find neighbors.
    for (let radius = 0; radius <= 4; radius++) {
      for (let x = -radius; x <= radius; x++)
        for (let y = -radius; y <= radius; y++)
          for (let z = -radius; z <= radius; z++) {
            if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== radius)
              continue;
            for (const b of cells.get(key(cx + x, cy + y, cz + z)) ?? []) {
              if (a === b) continue;
              const q = points[b].position;
              const d =
                (q[0] - point.position[0]) ** 2 +
                (q[1] - point.position[1]) ** 2 +
                (q[2] - point.position[2]) ** 2;
              let insert = candidates.length;
              while (
                insert > 0 &&
                (d < candidates[insert - 1].d ||
                  (d === candidates[insert - 1].d &&
                    b < candidates[insert - 1].b))
              )
                insert--;
              if (insert < 6) {
                candidates.splice(insert, 0, { b, d });
                if (candidates.length > 6) candidates.pop();
              }
            }
          }
      if (radius >= 1 && candidates.length >= 6) break;
    }
    candidates.forEach((p) => connect(a, p.b));
    // A few hub pathways preserve region structure without thousands of long spokes.
    if (a >= 4 && a % 128 === 0) connect(a, point.cluster);
  });
  // No hub-to-hub synapses: stages only connect through the core. A few short
  // midline synapses keep the two hemispheres one network instead.
  const tissue = points.map((_, i) => i).slice(4),
    left = tissue.filter((i) => points[i].position[0] < 0);
  tissue
    .filter((i) => points[i].position[0] > 0)
    .sort((a, b) => points[a].position[0] - points[b].position[0])
    .slice(0, 12)
    .forEach((a) => {
      let best = -1,
        bestDistance = Infinity;
      for (const b of left) {
        const d = Math.hypot(
          ...points[b].position.map((v, k) => v - points[a].position[k]),
        );
        if (d < bestDistance) {
          bestDistance = d;
          best = b;
        }
      }
      if (best >= 0) connect(a, best);
    });
  return { points, edges };
}
