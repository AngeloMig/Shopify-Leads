import { useMemo, useState } from "react";
import type { RunStar } from "./research-network-model";

/** Stable random numbers per run, so a run's constellation never changes shape. */
function seeded(text: string) {
  let seed = 2166136261;
  for (const ch of text) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const width = 1000,
  height = 600;
/** Brightness grows with leads found; audits sit at a steady middle glow. */
const brightness = (run: RunStar) =>
  run.kind === "audit"
    ? 0.5
    : 0.3 + 0.7 * Math.min(1, Math.log1p(run.leads) / Math.log1p(25));

/**
 * Run history as a star map: each past run is a constellation, brighter the more
 * leads it found. Picking one flies back into that run's brain.
 */
export default function RunStarMap({
  runs,
  currentId,
  onPick,
  onClose,
}: {
  runs: RunStar[];
  currentId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const field = useMemo(() => {
    const rand = seeded("field");
    return Array.from({ length: 140 }, () => ({
      x: rand() * width,
      y: rand() * height,
      r: 0.5 + rand() * 1.1,
      delay: rand() * 4,
    }));
  }, []);
  const constellations = useMemo(
    () =>
      runs.map((run, i) => {
        const rand = seeded(run.id),
          angle = i * 2.399963 + 0.6,
          radius = 40 + 58 * Math.sqrt(i),
          cx = Math.max(
            70,
            Math.min(width - 70, width / 2 + Math.cos(angle) * radius * 1.6),
          ),
          cy = Math.max(
            60,
            Math.min(height - 70, height / 2 + Math.sin(angle) * radius * 0.85),
          ),
          glow = brightness(run),
          stars = Array.from({ length: 3 + Math.floor(rand() * 4) }, () => {
            const a = rand() * Math.PI * 2,
              d = 10 + rand() * 34;
            return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.8 };
          }).sort(
            (p, q) =>
              Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx),
          );
        return { run, cx, cy, glow, stars };
      }),
    [runs],
  );
  return (
    <div className="run-star-map">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Run history. Each constellation is a past run; brighter ones found more leads."
      >
        <defs>
          <filter
            id="run-star-glow"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="run-star-field" aria-hidden="true">
          {field.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              style={{ animationDelay: `${s.delay}s` }}
            />
          ))}
        </g>
        {constellations.map(({ run, cx, cy, glow, stars }) => {
          const current = run.id === currentId,
            shown = current || focus === run.id;
          return (
            <g
              key={run.id}
              className={`run-constellation ${run.status} ${current ? "current" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`${run.label}, ${run.kind === "audit" ? "website audit" : `store discovery, ${run.leads} ${run.leads === 1 ? "lead" : "leads"}`}, ${run.status}${current ? ", current run" : ""}`}
              onMouseEnter={() => setFocus(run.id)}
              onMouseLeave={() => setFocus(null)}
              onFocus={() => setFocus(run.id)}
              onBlur={() => setFocus(null)}
              onClick={() => (current ? onClose() : onPick(run.id))}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                if (current) onClose();
                else onPick(run.id);
              }}
            >
              <circle
                className="run-constellation-hit"
                cx={cx}
                cy={cy}
                r={58}
              />
              <polyline
                points={stars.map((s) => `${s.x},${s.y}`).join(" ")}
                style={{ opacity: 0.15 + glow * 0.35 }}
              />
              {stars.map((s, i) => (
                <circle
                  key={i}
                  className="run-star"
                  cx={s.x}
                  cy={s.y}
                  r={(i === 0 ? 2.4 : 1.4) + glow * (i === 0 ? 3 : 1.6)}
                  style={{ opacity: 0.35 + glow * 0.65 }}
                  filter="url(#run-star-glow)"
                />
              ))}
              {current && (
                <circle className="run-current-ring" cx={cx} cy={cy} r={54} />
              )}
              {shown && (
                <text x={cx} y={cy + 66} textAnchor="middle">
                  <tspan className="run-star-name">{run.label}</tspan>
                  <tspan x={cx} dy="16" className="run-star-meta">
                    {run.kind === "audit"
                      ? `Website audit · ${run.status}`
                      : `${run.leads} ${run.leads === 1 ? "lead" : "leads"} · ${run.status}`}
                  </tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
