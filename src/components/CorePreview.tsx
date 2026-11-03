import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Group } from "three";
import {
  ArrowUpRight,
  Check,
  Compass,
  FileText,
  Globe2,
  Mail,
  Pause,
  Play,
  RotateCcw,
  Square,
  Zap,
} from "lucide-react";
import ScoutCore from "./ScoutCore";
import ScoutCoreGlyph from "./ScoutCoreGlyph";
import {
  coreEnergy,
  corePalettes,
  coreStates,
  stepCoreDrive,
  type CoreAppearance,
  type CorePalette,
  type CoreState,
} from "./scout-core-model";
import type { ActivitySignal } from "./neural-task-graph";

const sources = [
  {
    name: "Storefront",
    stage: "verify",
    icon: Globe2,
    position: [-1.35, 0.9, 0],
    color: "#65daf4",
  },
  {
    name: "PageSpeed",
    stage: "measure",
    icon: Zap,
    position: [1.35, 0.9, 0],
    color: "#7fa9ff",
  },
  {
    name: "Public contact",
    stage: "inspect",
    icon: Mail,
    position: [-1.35, -0.9, 0],
    color: "#c5a3ff",
  },
  {
    name: "Report",
    stage: "report",
    icon: FileText,
    position: [1.35, -0.9, 0],
    color: "#ffd08a",
  },
] as const;
const initialEvidence = [
  "Measurements saved",
  "Pages recorded",
  "Public contact",
  "Report ready",
].map((label, i) => ({ id: `sample-${i}`, label, ready: false }));
type SampleSignal = ActivitySignal & { source: number };
class PreviewBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function Scene({
  appearance,
  moving,
  signals,
  pulse,
  onPulse,
  reset,
  onUnavailable,
}: {
  appearance: CoreAppearance;
  moving: boolean;
  signals: SampleSignal[];
  pulse: number;
  onPulse: () => void;
  reset: number;
  onUnavailable: () => void;
}) {
  const { camera, gl, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null),
    time = useRef(0),
    packets = useRef<Group>(null),
    seen = useRef(new Set<string>()),
    trips = useRef<{ id: string; source: number; at: number }[]>([]);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enablePan = false;
    c.enableZoom = false;
    c.enableDamping = false;
    c.rotateSpeed = 0.55;
    controls.current = c;
    c.addEventListener("change", () => invalidate());
    const lost = (event: Event) => {
      event.preventDefault();
      onUnavailable();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      c.dispose();
      gl.domElement.removeEventListener("webglcontextlost", lost);
    };
  }, [camera, gl, invalidate, onUnavailable]);
  useEffect(() => {
    camera.position.set(0, 0.2, 3.8);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [reset, camera, invalidate]);
  useEffect(() => {
    signals.forEach((s) => {
      if (!seen.current.has(s.id) && moving)
        trips.current.push({ id: s.id, source: s.source, at: time.current });
      seen.current.add(s.id);
    });
    trips.current = trips.current.slice(-8);
    invalidate();
  }, [signals, moving, invalidate]);
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(invalidate, 1000 / 30);
    return () => clearInterval(timer);
  }, [moving, invalidate]);
  useEffect(() => invalidate(), [appearance, moving, invalidate]);
  useFrame((_, delta) => {
    if (moving) time.current += Math.min(delta, 0.08);
    trips.current = trips.current.filter((t) => time.current - t.at < 1.5);
    packets.current?.children.forEach((child, i) => {
      const trip = trips.current[i];
      child.visible = !!trip;
      if (!trip) return;
      const f = Math.max(0, Math.min(1, (time.current - trip.at) / 1.5)),
        start = sources[trip.source].position;
      child.position.set(
        start[0] * (1 - f),
        start[1] * (1 - f),
        Math.sin(f * Math.PI) * 0.2,
      );
      child.scale.setScalar(0.8 + Math.sin(f * Math.PI) * 0.6);
    });
  });
  return (
    <>
      <ScoutCore
        appearance={appearance}
        moving={moving}
        signals={signals}
        pulseToken={pulse}
        onPulse={onPulse}
      />
      {sources.map((s, i) => (
        <group key={s.name} position={[...s.position]}>
          <mesh raycast={() => {}}>
            <octahedronGeometry args={[0.025, 0]} />
            <meshBasicMaterial color={s.color} transparent opacity={0.5} />
          </mesh>
        </group>
      ))}
      <group ref={packets}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} visible={false} raycast={() => {}}>
            <octahedronGeometry args={[0.035, 0]} />
            <meshBasicMaterial color="#d9fff0" toneMapped={false} />
          </mesh>
        ))}
      </group>
    </>
  );
}
export default function CorePreview() {
  const [palette, setPalette] = useState<CorePalette>("gold"),
    [state, setState] = useState<CoreState>("ready"),
    [running, setRunning] = useState(false),
    [paused, setPaused] = useState(false),
    [flat, setFlat] = useState(false),
    [unavailable, setUnavailable] = useState(false),
    [evidence, setEvidence] = useState(initialEvidence),
    [signals, setSignals] = useState<SampleSignal[]>([]),
    [pulse, setPulse] = useState(0),
    [reset, setReset] = useState(0),
    [generation, setGeneration] = useState(0),
    [power, setPower] = useState(0),
    [phase, setPhase] = useState("Idle"),
    [lastSignal, setLastSignal] = useState("No sample signals yet"),
    [foreground, setForeground] = useState(!document.hidden),
    [visible, setVisible] = useState(true),
    [reduced, setReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  const panel = useRef<HTMLDivElement>(null),
    drive = useRef(0),
    sequence = useRef(0),
    pendingSignals = useRef<SampleSignal[]>([]);
  const moving = !paused && !reduced && foreground && visible;
  const appearance: CoreAppearance = {
    state,
    palette,
    evidence,
    working: running,
  };
  const fallback = flat || unavailable || reduced;
  const fail = useCallback(() => setUnavailable(true), []);
  useEffect(() => {
    const fg = () => setForeground(!document.hidden),
      media = matchMedia("(prefers-reduced-motion: reduce)"),
      change = () => setReduced(media.matches);
    document.addEventListener("visibilitychange", fg);
    media.addEventListener("change", change);
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    if (panel.current) observer.observe(panel.current);
    return () => {
      document.removeEventListener("visibilitychange", fg);
      media.removeEventListener("change", change);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!moving) return;
    let frame = 0,
      last = 0,
      lastReadout = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = last ? Math.min((now - last) / 1000, 0.08) : 0;
      last = now;
      drive.current = stepCoreDrive(drive.current, running, dt);
      if (now - lastReadout > 100) {
        setPower(Math.round(coreEnergy(drive.current) * 100));
        setPhase(
          running
            ? drive.current >= 1
              ? "Full light"
              : "Accelerating"
            : drive.current > 0
              ? "Cooling down"
              : "Idle",
        );
        lastReadout = now;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving, running, generation]);
  useEffect(() => {
    if (!moving || !pendingSignals.current.length) return;
    const queued = pendingSignals.current;
    pendingSignals.current = [];
    setSignals((old) => [...old, ...queued].slice(-16));
    setLastSignal("Queued sample signals arriving");
  }, [moving]);
  const send = (source: number) => {
    const s = sources[source];
    const signal: SampleSignal = {
      id: `sample-${++sequence.current}`,
      stage: s.stage,
      back: true,
      source,
    };
    if (moving) {
      setSignals((old) => [...old, signal].slice(-16));
      setLastSignal(`${s.name} sample sent`);
    } else {
      pendingSignals.current = [...pendingSignals.current, signal].slice(-8);
      setLastSignal(
        `${s.name} queued · ${paused ? "resume the visual to view it" : reduced ? "reduced motion is on" : "return to the core to view it"}`,
      );
    }
  };
  const start = () => {
    setRunning(!running);
    setPaused(false);
    setState(running ? "ready" : "discover");
  };
  const save = () => {
    const index = evidence.findIndex((e) => !e.ready);
    if (index < 0) return;
    setEvidence((old) =>
      old.map((e, i) => (i === index ? { ...e, ready: true } : e)),
    );
    send([1, 0, 2, 3][index]);
    if (index === 3) {
      setRunning(false);
      setState("complete");
    }
  };
  const restart = () => {
    drive.current = 0;
    pendingSignals.current = [];
    setPower(0);
    setPhase("Idle");
    setRunning(false);
    setState("ready");
    setEvidence(initialEvidence);
    setSignals([]);
    setPulse(0);
    setPaused(false);
    setLastSignal("No sample signals yet");
    setGeneration((n) => n + 1);
    setReset((n) => n + 1);
  };
  return (
    <>
      <header className="preview-header">
        <a href="/jobs" className="preview-brand">
          <Compass size={25} />
          <strong>scout.</strong>
          <span>Core preview</span>
        </a>
        <a href="/scout-core-lab.html">
          Five individual studies <ArrowUpRight size={14} />
        </a>
      </header>
      <main className="preview-page">
        <div className="preview-intro">
          <div>
            <h1>One core. All five ideas.</h1>
            <p>
              Watch Scout turn quiet orbits into light, then bring its work back
              home.
            </p>
          </div>
          <button className="preview-launch" onClick={start}>
            {running ? <Square size={14} /> : <Play size={14} />}
            {running ? "Stop sample" : "Run sample"}
          </button>
        </div>
        <div className="preview-notice">
          <span>
            <i />
            Interactive sample · No provider requests or API credits.
          </span>
          <span>Uses the same core components as the app.</span>
        </div>
        <div className="preview-workspace">
          <section
            className="preview-stage"
            aria-label="Combined Scout core preview"
          >
            <div className="preview-stage-toolbar">
              <span>
                <i style={{ background: coreStates[state].color }} />
                {coreStates[state].label}
                <small>Simulated state</small>
              </span>
              <div>
                <button
                  aria-pressed={paused}
                  onClick={() => setPaused((v) => !v)}
                  disabled={reduced}
                >
                  {paused ? <Play size={14} /> : <Pause size={14} />}{" "}
                  {paused ? "Resume visual" : "Pause visual"}
                </button>
                <button
                  onClick={() => setReset((n) => n + 1)}
                  aria-label="Reset camera"
                >
                  <RotateCcw size={14} />
                </button>
                <button
                  aria-pressed={fallback}
                  onClick={() => setFlat((v) => !v)}
                  disabled={reduced || unavailable}
                >
                  {fallback ? "Use 3D" : "Use 2D"}
                </button>
              </div>
            </div>
            <div className="preview-canvas" ref={panel}>
              {fallback ? (
                <div className="preview-flat">
                  <ScoutCoreGlyph
                    key={generation}
                    appearance={appearance}
                    moving={moving}
                    signals={signals}
                  />
                </div>
              ) : (
                <PreviewBoundary key={generation} onError={fail}>
                  <Canvas
                    frameloop="demand"
                    flat
                    dpr={[1, 1.5]}
                    camera={{ position: [0, 0.2, 3.8], fov: 44 }}
                    gl={{
                      alpha: true,
                      antialias: true,
                      powerPreference: "low-power",
                    }}
                    aria-label="Interactive three dimensional Scout core"
                  >
                    <Scene
                      appearance={appearance}
                      moving={moving}
                      signals={signals}
                      pulse={pulse}
                      onPulse={() => setPulse((n) => n + 1)}
                      reset={reset}
                      onUnavailable={fail}
                    />
                  </Canvas>
                </PreviewBoundary>
              )}
              <div
                className="preview-source-labels"
                aria-label="Send a sample signal to the core"
              >
                {sources.map((s, i) => (
                  <button
                    key={s.name}
                    onClick={() => send(i)}
                    disabled={paused || reduced}
                    aria-label={`Send ${s.name} sample`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              <div className="preview-core-name" aria-hidden="true">
                scout
                <span>
                  {running
                    ? "Research engine · sample work"
                    : "Research engine"}
                </span>
              </div>
              <div className="preview-scene-caption">
                <span>
                  {fallback
                    ? "Steady 2D companion"
                    : "Drag to orbit · click the core to send a pulse"}
                </span>
                <span>
                  {reduced
                    ? "Reduced motion"
                    : paused
                      ? "Visual paused"
                      : "Collisions are visual effects"}
                </span>
              </div>
            </div>
            <div className="preview-energy">
              <div>
                <strong aria-live="polite">
                  {paused
                    ? "Visual paused"
                    : reduced
                      ? "Reduced motion"
                      : phase}
                </strong>
                <span>
                  <output aria-live="off">{power}%</output> visual power
                </span>
              </div>
              <progress
                aria-label="Visual core power"
                max="100"
                value={power}
              />
              <p>
                {phase === "Full light"
                  ? "Continuous light, no orbiting dots. Random blooms appear where the beams meet."
                  : running
                    ? "The rings accelerate over five seconds and gradually close their gaps."
                    : "Slow, open orbits. Start sample work to charge the collider."}
              </p>
            </div>
            <div
              className="preview-evidence"
              aria-label="Sample evidence constellation"
            >
              {evidence.map((e, i) => (
                <span key={e.id} className={e.ready ? "is-ready" : ""}>
                  <i>{e.ready ? <Check size={11} /> : i + 1}</i>
                  {e.label}
                </span>
              ))}
            </div>
          </section>
          <aside className="preview-controls" aria-label="Preview controls">
            <section>
              <div className="preview-control-title">
                <span>01</span>
                <h2>Photon collider</h2>
              </div>
              <p>
                Slow gaps at rest. Pure light at full power. Stop work to watch
                it settle.
              </p>
              <div className="preview-actions">
                <button className="preview-primary" onClick={start}>
                  {running ? <Square size={14} /> : <Play size={14} />}{" "}
                  {running ? "Stop sample work" : "Start sample work"}
                </button>
                <button
                  onClick={restart}
                  aria-label="Reset entire preview"
                  title="Reset entire preview"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </section>
            <section>
              <div className="preview-control-title">
                <span>02</span>
                <h2>Color harmony</h2>
              </div>
              <div className="preview-palettes">
                {corePalettes.map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={palette === p.id}
                    onClick={() => setPalette(p.id)}
                  >
                    <span>
                      {p.colors.map((c) => (
                        <i key={c} style={{ background: c }} />
                      ))}
                    </span>
                    {p.name}
                    {palette === p.id && <Check size={14} />}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <div className="preview-control-title">
                <span>03</span>
                <h2>Work spectrum</h2>
              </div>
              <label
                className="preview-state-label"
                htmlFor="sample-work-state"
              >
                Sample work state
              </label>
              <select
                id="sample-work-state"
                value={state}
                onChange={(e) => setState(e.target.value as CoreState)}
              >
                {Object.entries(coreStates).map(([id, s]) => (
                  <option key={id} value={id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <small>
                Changes the core color. The work button controls its energy.
              </small>
            </section>
            <section>
              <div className="preview-control-title">
                <span>04</span>
                <h2>Signal intake</h2>
              </div>
              <p>
                Send a sample result inward. The core acknowledges its arrival.
              </p>
              <div className="preview-sources">
                {sources.map((s, i) => (
                  <button
                    key={s.name}
                    onClick={() => send(i)}
                    disabled={paused || reduced}
                  >
                    <s.icon size={14} />
                    {s.name}
                  </button>
                ))}
              </div>
              <small role="status">{lastSignal}</small>
            </section>
            <section>
              <div className="preview-control-title">
                <span>05</span>
                <h2>Evidence bloom</h2>
              </div>
              <p>
                Each saved sample lights a marker. The fourth settles the core
                into completion.
              </p>
              <button
                className="preview-save"
                onClick={save}
                disabled={evidence.every((e) => e.ready)}
              >
                <Check size={14} />
                {evidence.every((e) => e.ready)
                  ? "All sample evidence saved"
                  : "Save next sample evidence"}
              </button>
              <small>
                {evidence.filter((e) => e.ready).length} of 4 sample milestones
              </small>
            </section>
          </aside>
        </div>
        <footer className="preview-footer">
          <span>
            Sample signals and evidence stay in this page. Nothing is saved to
            your workspace.
          </span>
          <a href="/jobs">
            Back to research <ArrowUpRight size={14} />
          </a>
        </footer>
      </main>
    </>
  );
}
