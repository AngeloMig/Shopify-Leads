import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import ScoutCore from "./ScoutCore";
import type { CoreAppearance, CoreState } from "./scout-core-model";

const noSignals: never[] = [];
const noPulse = () => {};
const evidence = ["search", "store", "contact", "audit"].map((id) => ({
  id,
  label: id,
  ready: false,
}));
/** The same core as the Automation jobs map, framed to fill a small canvas. */
export default function MiniCore({ state }: { state: CoreState }) {
  const [moving, setMoving] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMoving(!query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const appearance: CoreAppearance = {
    state,
    working: true,
    palette: "gold",
    evidence,
  };
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 9], zoom: 32, near: 0.1, far: 40 }}
      dpr={[2, 3]}
      flat
      frameloop={moving ? "always" : "demand"}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    >
      <ScoutCore
        appearance={appearance}
        moving={moving}
        signals={noSignals}
        pulseToken={0}
        onPulse={noPulse}
      />
    </Canvas>
  );
}
