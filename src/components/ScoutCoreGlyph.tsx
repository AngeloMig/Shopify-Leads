import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  coreEnergy,
  corePalettes,
  coreStates,
  stepCoreDrive,
  type CoreAppearance,
} from "./scout-core-model";
import type { ActivitySignal } from "./neural-task-graph";
/** Lightweight companion for the task map, including the reduced-motion fallback. */
export default function ScoutCoreGlyph({
  appearance,
  moving,
  signals,
}: {
  appearance: CoreAppearance;
  moving: boolean;
  signals: ActivitySignal[];
}) {
  const root = useRef<SVGSVGElement>(null),
    drive = useRef(0),
    phase = useRef(0),
    elapsed = useRef(0),
    nextCollision = useRef(6),
    collision = useRef(-10);
  const seen = useRef(new Set(signals.map((s) => s.id))),
    intake = useRef(-10);
  const palette = corePalettes.find((p) => p.id === appearance.palette)!;
  const working = appearance.working;
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setOnScreen(entry.isIntersecting),
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    signals.forEach((s) => {
      if (!seen.current.has(s.id) && s.back && moving && onScreen)
        intake.current = elapsed.current;
    });
    seen.current = new Set(signals.map((s) => s.id));
  }, [signals, moving, onScreen]);
  useEffect(() => {
    if (!moving || !onScreen) return;
    let frame = 0,
      last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last && now - last < 1000 / 30) return;
      const dt = last ? Math.min((now - last) / 1000, 0.08) : 0;
      last = now;
      elapsed.current += dt;
      drive.current = stepCoreDrive(drive.current, working, dt);
      const energy = coreEnergy(drive.current);
      phase.current += dt * (12 + energy * 1000);
      root.current
        ?.querySelectorAll<SVGCircleElement>("[data-beam]")
        .forEach((circle, i) => {
          circle.setAttribute(
            "stroke-dasharray",
            `${65 + 35 * energy} ${35 * (1 - energy)}`,
          );
          circle.setAttribute(
            "transform",
            `rotate(${phase.current * (i % 2 ? -1 : 1)} 32 32)`,
          );
          circle.style.strokeWidth = `${0.6 + energy * 0.6}px`;
        });
      const engine = root.current?.querySelector<SVGGElement>("[data-engine]");
      engine?.setAttribute(
        "transform",
        `translate(${Math.sin(elapsed.current * 2.4) * energy} ${Math.cos(elapsed.current * 3.1) * energy}) rotate(${phase.current * 0.045} 32 32)`,
      );
      if (
        working &&
        energy > 0.985 &&
        elapsed.current >= nextCollision.current
      ) {
        collision.current = elapsed.current;
        nextCollision.current = elapsed.current + 1.3 + Math.random() * 1.7;
        root.current
          ?.querySelector("[data-collision]")
          ?.setAttribute("transform", `rotate(${Math.random() * 360} 32 32)`);
      }
      const spark =
        root.current?.querySelector<SVGGElement>("[data-collision]");
      if (spark)
        spark.style.opacity = `${Math.max(0, 1 - (elapsed.current - collision.current) / 1.1)}`;
      const halo =
        root.current?.querySelector<SVGCircleElement>("[data-intake]");
      if (halo)
        halo.style.opacity = `${Math.max(0, 1 - (elapsed.current - intake.current)) * 0.7}`;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving, working, onScreen]);
  return (
    <svg
      ref={root}
      viewBox="0 0 64 64"
      className="scout-core-glyph"
      style={
        { "--core-state": coreStates[appearance.state].color } as CSSProperties
      }
      aria-hidden="true"
    >
      <g data-engine>
        <circle cx="32" cy="32" r="13" />
        <path d="m32 18 13 8v13l-13 8-13-8V26Zm-13 8 26 13m0-13L19 39m13-21v29M19 26l13 8 13-8m-26 13 13-5 13 5" />
      </g>
      {[0, 1, 2].map((i) => (
        <g
          key={i}
          transform={`translate(32 32) rotate(${i * 60}) scale(1 .68) translate(-32 -32)`}
        >
          <circle
            data-beam
            cx="32"
            cy="32"
            r="25"
            pathLength="100"
            strokeDasharray="65 35"
            stroke={palette.colors[i]}
          />
        </g>
      ))}
      <circle data-intake cx="32" cy="32" r="17" opacity="0" />
      <g data-collision opacity="0">
        <path d="M52 27v10m-5-5h10m-8-3 6 6m-6 0 6-6" />
      </g>
      {appearance.evidence.map((e, i) => {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        return (
          <rect
            key={e.id}
            x={31 + Math.cos(a) * 28}
            y={31 + Math.sin(a) * 28}
            width="2"
            height="2"
            fill={e.ready ? palette.colors[0] : "#658080"}
            opacity={e.ready ? 1 : 0.3}
            stroke="none"
          />
        );
      })}
    </svg>
  );
}
