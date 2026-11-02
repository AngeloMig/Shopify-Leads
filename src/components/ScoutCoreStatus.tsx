import type { CSSProperties } from "react";
import { Check, Circle } from "lucide-react";
import {
  corePalettes,
  coreStates,
  type CoreAppearance,
  type CorePalette,
} from "./scout-core-model";
import "../scout-core.css";
export default function ScoutCoreStatus({
  appearance,
  onPalette,
  onEvidence,
}: {
  appearance: CoreAppearance;
  onPalette: (palette: CorePalette) => void;
  onEvidence: () => void;
}) {
  const state = coreStates[appearance.state];
  return (
    <div
      className="scout-core-status"
      style={{ "--core-state": state.color } as CSSProperties}
    >
      <div className="scout-core-state">
        <i />
        <span>
          Core <strong>{state.label}</strong>
        </span>
        <small>Its glow shows activity, not results.</small>
      </div>
      <label>
        Colors{" "}
        <select
          value={appearance.palette}
          onChange={(e) => onPalette(e.target.value as CorePalette)}
        >
          {corePalettes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div
        className="scout-core-evidence"
        aria-label="Recorded evidence milestones"
      >
        {appearance.evidence.map((e) => (
          <button
            key={e.id}
            className={e.ready ? "ready" : ""}
            onClick={onEvidence}
            title={`${e.label}: ${e.ready ? "Recorded" : "Not recorded"}. Open saved evidence.`}
          >
            {e.ready ? <Check size={12} /> : <Circle size={10} />}
            <span>{e.label}</span>
            <span className="sr-only">
              {e.ready ? "Recorded" : "Not recorded"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
