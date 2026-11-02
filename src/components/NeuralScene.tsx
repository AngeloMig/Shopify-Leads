import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import {
  Color,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  OrthographicCamera,
  Vector3,
  MathUtils,
  MeshBasicMaterial,
  AdditiveBlending,
} from "three";
import type { WorkStage } from "../../shared/job-activity";
import { isWorkingTask, type ResearchTask } from "../../shared/research-tasks";
import { type NetworkPoint } from "./research-network-model";
import {
  coreAnchorId,
  curvedLink,
  linkChipId,
  pointOnRoute,
  routeLength,
  signalRoute,
  semanticColor,
  type ActivitySignal,
  type SemanticGraph,
  type SemanticNode,
  type SemanticEdge,
  type NeuralView,
} from "./neural-task-graph";
import NeuralAtmosphere from "./NeuralAtmosphere";
import ScoutCore, { type CoreLight } from "./ScoutCore";
import type { CoreAppearance } from "./scout-core-model";
export type CameraCommand = {
  action: "reset" | "in" | "out" | "left" | "right";
  id: number;
};
export type ProjectedNode = { id: string; x: number; y: number };
type Props = {
  graph: SemanticGraph;
  coreAppearance: CoreAppearance;
  neuronCount: number;
  selectedTask: string | null;
  selectedStage: WorkStage | null;
  hovered: string | null;
  view: NeuralView;
  moving: boolean;
  working: boolean;
  exploring: boolean;
  activitySignals: ActivitySignal[];
  cameraCommand: CameraCommand;
  pulseToken: number;
  tracing: boolean;
  orbiting: boolean;
  tissue: boolean;
  onPulse: () => void;
  onPick: (node: SemanticNode) => void;
  /** Double-click on a stage: zoom into it and fan its tasks out. */
  onZoomStage: (stage: WorkStage) => void;
  /** Stage currently zoomed into, if any. */
  spread: WorkStage | null;
  /** Discovery funnel counts, which drive the pipeline particles. */
  funnel?: { returned: number; checked: number; queued: number } | null;
  onHover: (id: string | null) => void;
  onProject: (nodes: ProjectedNode[], width: number, height: number) => void;
  onUnavailable: () => void;
  fallback: ReactNode;
};
/** Signals travel at one speed so short task links and long stage routes read alike. */
const signalSpeed = 2.6,
  trailLength = 0.42,
  trailSamples = 14,
  signalCapacity = 256,
  arrivalLife = 0.7;
const ease = (f: number) => 0.5 - 0.5 * Math.cos(Math.PI * f);
const WHITE = new Color("#ffffff");
type Journey = {
  id: string;
  points: NetworkPoint[];
  length: number;
  duration: number;
  started: number;
  preview?: boolean;
  color?: Color;
  arrived?: boolean;
};
const journey = (
  id: string,
  points: NetworkPoint[],
  started: number,
  preview?: boolean,
  color?: Color,
): Journey => {
  const length = routeLength(points);
  return {
    id,
    points,
    length,
    duration: MathUtils.clamp(length / signalSpeed, 0.8, 2.2),
    started,
    preview,
    color,
  };
};
const HIGHLIGHT = "#d3fff0",
  issueColor = new Color("#f2a39b"),
  retryColor = new Color("#efc27f");
/** New links draw outward from their source; nodes pop in as their link lands. */
const growTime = { primary: 0.38, branch: 0.38, result: 0.5 } as const,
  growDelay = { primary: 0, branch: 0.12, result: 0.24 } as const,
  popDelay = { core: 0, stage: 0.3, task: 0.42, cluster: 0.42, result: 0.64 },
  flashTime = 0.7;
const now = () => performance.now() / 1000;
const backOut = (x: number) =>
  1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const isFinished = (s: string) => s === "completed" || s === "skipped";
const isFailed = (s: string) => s === "failed" || s === "interrupted";
const finishColor = new Color("#79d6ba"),
  memoryColor = new Color("#a2ffe2"),
  skippedColor = new Color("#8fa3a8"),
  pipeColor = new Color("#c8fff1"),
  fxCapacity = 600;
/** A short-lived visual particle travelling along a polyline. */
type Fx = {
  points: NetworkPoint[];
  start: number;
  life: number;
  color: Color;
  size: number;
  /** in: brightens on arrival · out: fades away · arc: up then down · drop: fades after fadeFrom. */
  fade: "in" | "out" | "arc" | "drop" | "travel";
  fadeFrom?: number;
  ease?: (f: number) => number;
};
const fxAlpha = (fx: Fx, f: number) =>
  fx.fade === "in"
    ? f
    : fx.fade === "out"
      ? 1 - f
      : fx.fade === "arc"
        ? Math.sin(Math.PI * f)
        : fx.fade === "drop"
          ? Math.min(1, f * 8) *
            (f < (fx.fadeFrom ?? 0.6)
              ? 1
              : 1 - (f - (fx.fadeFrom ?? 0.6)) / (1 - (fx.fadeFrom ?? 0.6)))
          : Math.min(1, f * 8) * Math.min(1, (1 - f) * 10);
const randomDirection = (): NetworkPoint => {
  const z = Math.random() * 2 - 1,
    a = Math.random() * Math.PI * 2,
    r = Math.sqrt(1 - z * z);
  return [Math.cos(a) * r, Math.sin(a) * r, z];
};
const along = (a: NetworkPoint, dir: NetworkPoint, k: number): NetworkPoint => [
  a[0] + dir[0] * k,
  a[1] + dir[1] * k,
  a[2] + dir[2] * k,
];
const isFlowing = (s: string) =>
  s === "active" || isWorkingTask(s as ResearchTask["state"]);
function SemanticLink({
  edge,
  highlight,
  dim,
  moving,
  idle,
  phase,
  state,
  light,
  traceAt,
  traceDelay,
  bootAt,
  bootDelay,
  finishAt,
  onHover,
  onPick,
}: {
  edge: SemanticEdge;
  highlight: boolean;
  dim: boolean;
  moving: boolean;
  idle: boolean;
  phase: number;
  state: string;
  /** Core light; stage links glow brightest where they leave the core. */
  light: { current: CoreLight };
  /** When the selected route started tracing (seconds, performance clock). */
  traceAt: number;
  /** This link's place in the traced route, or null when it isn't on it. */
  traceDelay: number | null;
  /** Boot sequence start and this link's turn in it (seconds). */
  bootAt: number;
  bootDelay: number;
  /** When the whole run finished; links flash green outward from the core. */
  finishAt: number;
  onHover: (id: string | null) => void;
  onPick: () => void;
}) {
  const flowing = isFlowing(state);
  const { size, invalidate } = useThree();
  const born = useRef(now()),
    base = useRef(0.5),
    lastState = useRef(state),
    flash = useRef<{ at: number; color: Color } | null>(null);
  const line = useMemo(() => {
    const geometry = new LineGeometry();
    geometry.setPositions(edge.points.flat());
    const material = new LineMaterial({
      color: "#75bcae",
      linewidth:
        edge.kind === "primary" ? 2 : edge.kind === "result" ? 0.9 : 1.3,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const mesh = new Line2(geometry, material);
    mesh.computeLineDistances();
    return mesh;
  }, [edge]);
  // Running work gets dashes marching outward on top of the steady link.
  const flow = useMemo(() => {
    const mesh = new Line2(
      line.geometry,
      new LineMaterial({
        color: HIGHLIGHT,
        linewidth: 2,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        dashed: true,
        dashSize: 0.07,
        gapSize: 0.26,
      }),
    );
    mesh.raycast = () => {};
    return mesh;
  }, [line]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  useEffect(() => () => flow.material.dispose(), [flow]);
  const lit = useMemo(() => {
    if (edge.kind !== "primary") return null;
    const points = edge.points.slice(0, 13),
      geometry = new LineGeometry();
    geometry.setPositions(points.flat());
    geometry.setColors(
      points.flatMap((_, i) => {
        const k = (1 - i / (points.length - 1)) ** 1.6;
        return [k, k, k];
      }),
    );
    const mesh = new Line2(
      geometry,
      new LineMaterial({
        vertexColors: true,
        linewidth: 3.2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    mesh.raycast = () => {};
    return mesh;
  }, [edge]);
  useEffect(
    () => () => {
      lit?.geometry.dispose();
      lit?.material.dispose();
    },
    [lit],
  );
  // Selected route: a bright line draws along this link in turn, then settles
  // into a soft glow while the task stays selected.
  const traced = traceDelay !== null;
  const trace = useMemo(() => {
    if (!traced) return null;
    const geometry = new LineGeometry();
    geometry.setPositions(edge.points.flat());
    const mesh = new Line2(
      geometry,
      new LineMaterial({
        color: HIGHLIGHT,
        linewidth: 3.4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    mesh.raycast = () => {};
    return mesh;
  }, [edge, traced]);
  useEffect(
    () => () => {
      trace?.geometry.dispose();
      trace?.material.dispose();
    },
    [trace],
  );
  // A finished task's link fills with its result colour; a failure flashes once.
  useEffect(() => {
    const was = lastState.current;
    lastState.current = state;
    if (
      moving &&
      was !== state &&
      (isFinished(state) || isFailed(state)) &&
      !isFinished(was) &&
      !isFailed(was)
    )
      flash.current = { at: now(), color: new Color(semanticColor(state)) };
    invalidate();
  }, [state, moving, invalidate]);
  useEffect(() => {
    if (!finishAt || !moving) return;
    flash.current = {
      at:
        finishAt +
        (edge.kind === "primary" ? 0.35 : edge.kind === "branch" ? 0.55 : 0.75),
      color: finishColor,
    };
    invalidate();
  }, [finishAt, moving, edge.kind, invalidate]);
  useEffect(() => {
    line.material.resolution.set(size.width, size.height);
    line.material.color.set(highlight ? HIGHLIGHT : semanticColor(state));
    // Core → stage links stay readable as the map's structure while a task is focused.
    base.current = highlight
      ? 0.9
      : dim
        ? edge.kind === "primary"
          ? 0.38
          : 0.13
        : edge.kind === "primary"
          ? 0.6
          : 0.43;
    line.material.opacity = base.current;
    flow.material.resolution.set(size.width, size.height);
    lit?.material.resolution.set(size.width, size.height);
    if (trace) {
      trace.material.resolution.set(size.width, size.height);
      trace.userData.tint = new Color(semanticColor(state));
    }
    flow.material.color.set(semanticColor(state)).lerp(WHITE, 0.55);
    flow.material.opacity = dim ? 0.3 : 0.7;
    flow.material.linewidth = edge.kind === "primary" ? 2.6 : 2.1;
    line.material.linewidth = highlight
      ? 2.5
      : edge.kind === "primary"
        ? 2
        : edge.kind === "result"
          ? 1
          : 1.3;
    invalidate();
  }, [
    line,
    flow,
    lit,
    trace,
    highlight,
    dim,
    size,
    invalidate,
    edge.kind,
    state,
  ]);
  useFrame((_, delta) => {
    const t = now();
    // Boot sequence: links extend stage by stage once the run powers up.
    const growStart = Math.max(
      born.current + growDelay[edge.kind],
      bootAt + bootDelay,
    );
    const grow = moving
      ? MathUtils.clamp((t - growStart) / growTime[edge.kind], 0, 1)
      : 1;
    line.geometry.instanceCount =
      grow < 1 ? Math.ceil(ease(grow) * (edge.points.length - 1)) : Infinity;
    let opacity = base.current;
    const f = flash.current;
    if (f) {
      const p = (t - f.at) / flashTime;
      if (p >= 1 || !moving) {
        flash.current = null;
        line.material.color.set(highlight ? HIGHLIGHT : semanticColor(state));
      } else if (p >= 0) {
        const k = (1 - p) ** 2;
        line.material.color.copy(f.color).lerp(WHITE, k * 0.6);
        opacity = Math.max(opacity, 0.5 + 0.5 * k);
      }
    }
    // With nothing running, stage links breathe slowly, each slightly out of step.
    if (idle && moving && edge.kind === "primary" && !highlight && !dim)
      opacity *= 0.78 + 0.22 * Math.sin(t * 0.9 + phase);
    line.material.opacity = opacity;
    if (moving && flowing)
      flow.material.dashOffset -= Math.min(delta, 0.08) * 0.45;
    if (lit) {
      lit.visible = grow >= 1;
      lit.material.opacity = Math.min(1, light.current.intensity * 0.85);
      lit.material.color.copy(light.current.color);
    }
    let tracing = false;
    if (trace && traceDelay !== null) {
      const p = moving
        ? MathUtils.clamp((t - traceAt - traceDelay) / 0.38, 0, 1)
        : 1;
      const settle = moving
        ? MathUtils.clamp((t - traceAt - traceDelay - 0.38) / 0.6, 0, 1)
        : 1;
      trace.geometry.instanceCount =
        p < 1 ? Math.ceil(ease(p) * (edge.points.length - 1)) : Infinity;
      trace.visible = p > 0;
      trace.material.opacity = p > 0 ? 1 - settle * 0.6 : 0;
      trace.material.color
        .set(HIGHLIGHT)
        .lerp(trace.userData.tint ?? WHITE, settle * 0.5);
      tracing = settle < 1;
    }
    if (grow < 1 || flash.current || tracing) invalidate();
  });
  return (
    <>
      <primitive
        object={line}
        onPointerOver={(e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          onHover(edge.id);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: { delta: number; stopPropagation: () => void }) => {
          if (e.delta > 5) return;
          e.stopPropagation();
          onPick();
        }}
      />
      {flowing && <primitive object={flow} />}
      {lit && <primitive object={lit} />}
      {trace && <primitive object={trace} />}
    </>
  );
}
function TaskNeuron({
  node,
  selected,
  moving,
  light,
  beat,
  bootAt,
  bootDelay,
  onPick,
  onDouble,
  onHover,
}: {
  node: SemanticNode;
  selected: boolean;
  moving: boolean;
  light: { current: CoreLight };
  /** Heartbeats per second for a running stage; 0 for none. */
  beat: number;
  bootAt: number;
  bootDelay: number;
  onDouble?: () => void;
  onPick: () => void;
  onHover: (id: string | null) => void;
}) {
  const shape = useRef<Mesh>(null),
    ring = useRef<Mesh>(null),
    phase = useRef(0),
    scale = useRef(1),
    beatPhase = useRef(0),
    born = useRef(now()),
    { invalidate, camera } = useThree();
  const working = ["starting", "running", "waiting", "active"].includes(
    node.state,
  );
  useEffect(() => invalidate(), [selected, node.state, invalidate]);
  useFrame((_, delta) => {
    if (ring.current) ring.current.quaternion.copy(camera.quaternion);
    const goal = selected ? 1.5 : 1;
    scale.current = MathUtils.damp(
      scale.current,
      goal,
      15,
      Math.min(delta, 0.08),
    );
    const pop = moving
      ? MathUtils.clamp(
          (now() -
            Math.max(born.current + popDelay[node.kind], bootAt + bootDelay)) /
            0.3,
          0,
          1,
        )
      : 1;
    const appear = pop < 1 ? Math.max(0, backOut(pop)) : 1;
    // A running stage beats "lub-dub": two quick swells, then rest.
    let pulse = 0;
    if (moving && beat > 0) {
      beatPhase.current =
        (beatPhase.current + Math.min(delta, 0.08) * beat) % 1;
      const b = beatPhase.current;
      pulse =
        Math.exp(-(((b - 0.06) / 0.05) ** 2)) +
        0.6 * Math.exp(-(((b - 0.24) / 0.05) ** 2));
    }
    if (shape.current)
      shape.current.scale.setScalar(
        scale.current * appear * (1 + pulse * 0.22),
      );
    if (Math.abs(scale.current - goal) > 0.002 || pop < 1) invalidate();
    let breath = 1;
    if (moving && working) {
      phase.current += Math.min(delta, 0.08);
      breath =
        1 +
        Math.sin(phase.current * (node.state === "waiting" ? 2 : 3.6)) * 0.12;
    }
    if (ring.current) {
      ring.current.scale.setScalar(breath * appear * (1 + pulse * 0.4));
      // Stage rings catch a little of the core's light, and flash on each beat.
      if (node.kind === "stage")
        (ring.current.material as MeshBasicMaterial).opacity =
          (selected ? 0.8 : 0.4) +
          light.current.intensity * 0.35 +
          pulse * 0.45;
    }
  });
  const radius =
    node.kind === "stage"
      ? 0.105
      : node.kind === "cluster"
        ? 0.08
        : node.kind === "result"
          ? 0.038
          : 0.052;
  const color = selected ? "#e2fff3" : semanticColor(node.state);
  return (
    <group
      position={node.position}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(node.id);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        if (e.delta > 5) return;
        e.stopPropagation();
        onPick();
      }}
      onDoubleClick={(e) => {
        if (!onDouble) return;
        e.stopPropagation();
        onDouble();
      }}
    >
      <mesh ref={shape}>
        {node.kind === "result" ? (
          <octahedronGeometry args={[radius, 0]} />
        ) : node.kind === "cluster" ? (
          <icosahedronGeometry args={[radius, 0]} />
        ) : (
          <sphereGeometry args={[radius, 12, 10]} />
        )}
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {(selected || working || node.kind === "stage") && (
        <mesh ref={ring}>
          <torusGeometry args={[radius * 1.65, 0.009, 5, 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={selected ? 0.8 : 0.4}
            depthWrite={false}
          />
        </mesh>
      )}
      <mesh>
        <sphereGeometry args={[node.kind === "stage" ? 0.21 : 0.145, 6, 5]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          colorWrite={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
function Scene(props: Props) {
  const { camera, size, gl, invalidate, raycaster } = useThree(),
    controls = useRef<OrbitControls | null>(null),
    body = useRef<Group>(null),
    signals = useRef<InstancedMesh>(null),
    ripples = useRef<InstancedMesh>(null),
    time = useRef(0),
    target = useRef(new Vector3()),
    viewTarget = useRef(new Vector3()),
    follow = useRef<Journey | null>(null),
    tween = useRef(false),
    zoomGoal = useRef(1);
  const userOrbit = useRef(false),
    lastPulse = useRef(0),
    orbitPhase = useRef(0),
    orbitOffset = useRef(0);
  const seen = useRef(new Set<string>()),
    journeys = useRef<Journey[]>([]),
    arrivals = useRef<
      { position: NetworkPoint; started: number; color: Color }[]
    >([]),
    lastStates = useRef(new Map<string, string>());
  const [alarm, setAlarm] = useState(0);
  const coreLight = useRef<CoreLight>({ intensity: 0, color: new Color() });
  const [traceAt, setTraceAt] = useState(0);
  // Boot sequence: plays when the map mounts and whenever work starts.
  const [bootAt, setBootAt] = useState(() => now());
  const wasWorking = useRef(props.working),
    flyIn = useRef(true),
    tweenRate = useRef(11);
  useEffect(() => {
    if (props.working && !wasWorking.current) {
      setBootAt(now());
      flyIn.current = true;
    }
    wasWorking.current = props.working;
  }, [props.working]);
  const bootDelayFor = (stage: WorkStage | undefined, extra: number) =>
    0.45 + Math.max(0, stageOrder.indexOf(stage)) * 0.3 + extra;
  const effects = useRef<Fx[]>([]),
    fx = useRef<InstancedMesh>(null),
    nextPipe = useRef(0);
  const addFx = (effect: Omit<Fx, "start">, delay = 0) => {
    effects.current.push({ ...effect, start: time.current + delay });
    if (effects.current.length > fxCapacity)
      effects.current.splice(0, effects.current.length - fxCapacity);
  };
  // Memory forming: sparks gather out of the tissue into a finished task's result.
  const converge = (at: NetworkPoint, color: Color) => {
    for (let i = 0; i < 22; i++) {
      const from = along(at, randomDirection(), 0.35 + Math.random() * 0.45);
      addFx({
        points: curvedLink(from, at, "branch"),
        life: 0.55 + Math.random() * 0.25,
        color,
        size: 0.022,
        fade: "in",
        ease: (f) => f * f,
      });
    }
  };
  // A failure does the opposite: its node shatters and the pieces drift and dim.
  const shatter = (at: NetworkPoint) => {
    for (let i = 0; i < 16; i++) {
      const dir = randomDirection();
      addFx({
        points: [
          at,
          along(along(at, dir, 0.3 + Math.random() * 0.35), [0, -1, 0], 0.25),
        ],
        life: 1.1 + Math.random() * 0.5,
        color: issueColor,
        size: 0.026,
        fade: "out",
        ease: (f) => 1 - (1 - f) ** 2,
      });
    }
  };
  // Finish shockwave: core contracts, releases, links flash, sparks settle back.
  const [finishAt, setFinishAt] = useState(0),
    [finishToken, setFinishToken] = useState(0);
  const lastCoreState = useRef(props.coreAppearance.state);
  useEffect(() => {
    const was = lastCoreState.current;
    lastCoreState.current = props.coreAppearance.state;
    if (
      !props.moving ||
      was === "complete" ||
      props.coreAppearance.state !== "complete"
    )
      return;
    setFinishAt(now());
    setFinishToken((n) => n + 1);
    for (let i = 0; i < 90; i++) {
      const dir = randomDirection(),
        to: NetworkPoint = [dir[0] * 3, dir[1] * 1.6, dir[2] * 1.2].map(
          (v) => v * (0.55 + Math.random() * 0.45),
        ) as NetworkPoint,
        apex: NetworkPoint = [to[0] * 0.5, to[1] * 0.5 + 0.8, to[2] * 0.5];
      addFx(
        {
          points: Array.from({ length: 12 }, (_, k) => {
            const u = k / 11,
              v = 1 - u;
            return [0, 1, 2].map(
              (j) => v * v * 0 + 2 * v * u * apex[j] + u * u * to[j],
            ) as NetworkPoint;
          }),
          life: 1.4 + Math.random() * 0.8,
          color: Math.random() < 0.5 ? finishColor : memoryColor,
          size: 0.022 + Math.random() * 0.012,
          fade: "arc",
          ease: (f) => 1 - (1 - f) ** 2,
        },
        0.35,
      );
    }
  }, [props.coreAppearance.state, props.moving]);
  // Pipeline: stores flow in, rejects fall away at Verify, survivors reach Queue.
  const pipeline = useMemo(() => {
    const hub = (stage: WorkStage) =>
      props.graph.nodes.find((n) => n.id === `stage:${stage}`);
    const search = hub("search"),
      verify = hub("verify"),
      queue = hub("queue");
    if (!search || !verify || !queue) return null;
    const funnel = props.funnel;
    const reject = MathUtils.clamp(
      funnel && funnel.checked > 0 ? 1 - funnel.queued / funnel.checked : 0.45,
      0.1,
      0.9,
    );
    const interval =
      funnel && funnel.returned > 0
        ? MathUtils.clamp(1.6 / Math.log2(funnel.returned + 2), 0.25, 0.9)
        : 0.6;
    return {
      search: search.position,
      verify: verify.position,
      queue: queue.position,
      active:
        search.state === "active" ||
        verify.state === "active" ||
        queue.state === "active",
      toVerify: curvedLink(search.position, verify.position, "branch"),
      toQueue: curvedLink(verify.position, queue.position, "branch"),
      reject,
      interval,
    };
  }, [props.graph, props.funnel]);
  useEffect(() => {
    if (props.selectedTask) setTraceAt(now());
  }, [props.selectedTask]);
  // Route of the selected task, in drawing order: core → stage → task → result.
  const traceOrder = useMemo(() => {
    const order = new Map<string, number>();
    const task = props.graph.nodes.find(
      (n) => n.kind === "task" && n.taskId === props.selectedTask,
    );
    if (!task) return order;
    for (const e of props.graph.edges) {
      if (e.kind === "primary" && e.stage === task.stage) order.set(e.id, 0);
      else if (e.taskId === props.selectedTask)
        order.set(e.id, e.kind === "branch" ? 0.32 : 0.64);
    }
    return order;
  }, [props.graph, props.selectedTask]);
  // Running stages beat about once a second, faster with more live tasks.
  const beats = useMemo(() => {
    const rates = new Map<string, number>();
    for (const n of props.graph.nodes) {
      if (n.kind !== "stage" || n.state !== "active") continue;
      const live = props.graph.nodes.filter(
        (t) => t.kind === "task" && t.stage === n.stage && isFlowing(t.state),
      ).length;
      rates.set(n.id, Math.min(2.2, 1 + live * 0.25));
    }
    return rates;
  }, [props.graph]);
  const previewColor = useMemo(() => new Color("#73cce4"), []),
    workerColor = useMemo(() => new Color("#d9fff0"), []),
    tint = useMemo(() => new Color(), []);
  const transform = useMemo(() => new Object3D(), []),
    vec = useMemo(() => new Vector3(), []),
    below = useMemo(() => new Vector3(), []);
  const baseZoom = Math.min(size.width / 8.6, size.height / 5.8);
  const selectedNode = props.graph.nodes.find(
    (n) => n.taskId === props.selectedTask && n.kind === "task",
  );
  const hoveredEdge = props.graph.edges.find((e) => e.id === props.hovered),
    hoveredNode = props.graph.nodes.find((n) => n.id === props.hovered);
  // Hovering a stage spotlights its whole branch, overriding the selected task.
  const spotlight =
    hoveredNode?.kind === "stage" ? (hoveredNode.stage ?? null) : null;
  const focusedTask = spotlight
      ? null
      : (hoveredEdge?.taskId ?? hoveredNode?.taskId ?? props.selectedTask),
    focusedStage =
      hoveredEdge?.stage ?? hoveredNode?.stage ?? props.selectedStage;
  const stateOf = useMemo(
    () => new Map(props.graph.nodes.map((n) => [n.id, n.state])),
    [props.graph],
  );
  const stageOrder = useMemo(
    () =>
      props.graph.nodes.filter((n) => n.kind === "stage").map((n) => n.stage),
    [props.graph],
  );
  const idle =
    !props.working &&
    !props.graph.edges.some((e) => isFlowing(stateOf.get(e.target) ?? ""));
  const activeStage = props.graph.nodes
    .filter((n) => n.kind === "stage")
    .findIndex((n) => n.state === "active");
  const retrying = useMemo(
    () =>
      props.graph.edges
        .filter(
          (e) => e.kind === "branch" && stateOf.get(e.target) === "retrying",
        )
        .map((e) => ({ points: e.points, length: routeLength(e.points) })),
    [props.graph, stateOf],
  );
  useEffect(() => {
    // Line2 hit-testing defaults to the drawn 1–2px width; give links a usable target.
    (
      raycaster.params as typeof raycaster.params & {
        Line2?: { threshold: number };
      }
    ).Line2 = { threshold: 12 };
  }, [raycaster]);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    controls.current = c;
    c.enablePan = false;
    c.enableZoom = false;
    c.enableDamping = false;
    c.minPolarAngle = 0.3;
    c.maxPolarAngle = 2.8;
    c.rotateSpeed = 0.55;
    camera.position.set(0, 0.4, 9);
    c.target.set(0, 0, 0);
    c.update();
    const change = () => invalidate(),
      start = () => {
        tween.current = false;
        userOrbit.current = true;
        orbitPhase.current = 0;
        orbitOffset.current = 0;
        gl.domElement.style.cursor = "grabbing";
      },
      end = () => {
        gl.domElement.style.cursor = "grab";
        userOrbit.current = false;
      };
    c.addEventListener("change", change);
    c.addEventListener("start", start);
    c.addEventListener("end", end);
    gl.domElement.style.cursor = "grab";
    return () => {
      c.dispose();
      controls.current = null;
    };
  }, [camera, gl, invalidate]);
  const lastBase = useRef(0);
  useEffect(() => {
    const node =
      props.view === "task"
        ? selectedNode
        : props.view === "stage"
          ? props.graph.nodes.find(
              (n) => n.id === `stage:${props.selectedStage}`,
            )
          : undefined;
    viewTarget.current.set(
      ...(node
        ? (node.position.map((v) => v * 0.45) as NetworkPoint)
        : ([0, 0, 0] as NetworkPoint)),
    );
    if (!follow.current) target.current.copy(viewTarget.current);
    zoomGoal.current =
      baseZoom *
      (props.view === "task"
        ? 1.35
        : props.view === "stage"
          ? props.spread === props.selectedStage
            ? 1.5
            : 1.13
          : 1);
    tween.current = true;
    invalidate();
  }, [
    props.view,
    props.selectedTask,
    props.selectedStage,
    props.spread,
    baseZoom,
    invalidate,
  ]);
  useEffect(() => {
    const c = controls.current;
    if (!c || !(camera instanceof OrthographicCamera)) return;
    const action = props.cameraCommand.action;
    if (action === "reset") {
      camera.position.set(0, 0.4, 9);
      c.target.set(0, 0, 0);
      target.current.set(0, 0, 0);
      camera.zoom = baseZoom;
      tween.current = false;
      orbitPhase.current = 0;
      orbitOffset.current = 0;
    } else if (action === "in" || action === "out") {
      camera.zoom = MathUtils.clamp(
        camera.zoom * (action === "in" ? 1.15 : 1 / 1.15),
        baseZoom * 0.75,
        baseZoom * 1.9,
      );
      tween.current = false;
    } else c.rotateLeft(action === "left" ? 0.2 : -0.2);
    camera.updateProjectionMatrix();
    c.update();
    invalidate();
  }, [props.cameraCommand, camera, invalidate]);
  useEffect(() => {
    const lost = (e: Event) => {
      e.preventDefault();
      props.onUnavailable();
    };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl, props.onUnavailable]);
  useEffect(() => {
    for (const signal of props.activitySignals) {
      if (seen.current.has(signal.id)) continue;
      seen.current.add(signal.id);
      if (props.moving)
        journeys.current.push(
          journey(signal.id, signalRoute(props.graph, signal), time.current),
        );
    }
    journeys.current = journeys.current.slice(-16);
    invalidate();
  }, [props.activitySignals, props.graph, props.moving, invalidate]);
  // A task that newly fails sends one red signal back to the core.
  useEffect(() => {
    for (const node of props.graph.nodes) {
      if (node.kind !== "task" || !node.taskId) continue;
      const was = lastStates.current.get(node.id);
      lastStates.current.set(node.id, node.state);
      if (props.moving && was && was !== node.state) {
        const result = props.graph.nodes.find(
          (n) => n.id === `result:${node.taskId}`,
        );
        if (isFinished(node.state) && !isFinished(was))
          converge(
            result?.position ?? node.position,
            node.state === "completed" ? memoryColor : skippedColor,
          );
        else if (isFailed(node.state) && !isFailed(was))
          shatter(result?.position ?? node.position);
      }
      if (!props.moving || !was || was === node.state || !isFailed(node.state))
        continue;
      journeys.current.push(
        journey(
          `issue:${node.id}:${time.current}`,
          signalRoute(props.graph, {
            id: node.id,
            stage: node.stage!,
            taskId: node.taskId,
            back: true,
          }),
          time.current,
          false,
          issueColor,
        ),
      );
      setAlarm((n) => n + 1);
    }
  }, [props.graph, props.moving]);
  useEffect(() => {
    if (!props.moving) {
      journeys.current = [];
      arrivals.current = [];
      effects.current = [];
      if (fx.current) fx.current.count = 0;
      if (signals.current) signals.current.count = 0;
      if (ripples.current) ripples.current.count = 0;
      invalidate();
      return;
    }
  }, [props.moving, invalidate]);
  const explorationRoutes = useMemo(() => {
    const taskNodes = props.graph.nodes.filter((n) => n.kind === "task");
    const chosen = taskNodes.find((n) => n.taskId === props.selectedTask);
    const nodes = chosen
      ? [chosen, ...taskNodes.filter((n) => n !== chosen)]
      : taskNodes;
    return nodes.slice(0, 6).map((n, i) => {
      const points = signalRoute(props.graph, {
        id: n.id,
        stage: n.stage!,
        taskId: n.taskId,
        back: i % 2 === 1,
      });
      return { id: n.id, points, length: routeLength(points) };
    });
  }, [props.graph, props.selectedTask]);
  useEffect(() => {
    if (props.pulseToken && props.pulseToken !== lastPulse.current) {
      lastPulse.current = props.pulseToken;
      const route = explorationRoutes[0];
      if (route)
        journeys.current.push(
          journey(
            `preview:${props.pulseToken}`,
            route.points,
            time.current,
            true,
          ),
        );
      invalidate();
    }
  }, [props.pulseToken, invalidate, explorationRoutes]);
  useEffect(() => invalidate(), [props.graph, props.hovered, invalidate]);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.08),
      c = controls.current;
    // Rescale in the same frame the canvas resizes, so labels never project
    // against a stale zoom (that showed as S.C.O.U.T. jumping on fullscreen).
    if (camera instanceof OrthographicCamera && lastBase.current !== baseZoom) {
      const ratio = lastBase.current ? baseZoom / lastBase.current : 0;
      camera.zoom = ratio ? camera.zoom * ratio : baseZoom;
      zoomGoal.current = ratio ? zoomGoal.current * ratio : baseZoom;
      lastBase.current = baseZoom;
      camera.updateProjectionMatrix();
    }
    // Boot fly-in: start pulled back and glide in while the brain powers up.
    if (flyIn.current && camera instanceof OrthographicCamera) {
      flyIn.current = false;
      if (props.moving) {
        camera.zoom = zoomGoal.current * 0.55;
        camera.updateProjectionMatrix();
        tweenRate.current = 2.6;
        tween.current = true;
      }
    }
    if (tween.current && c && camera instanceof OrthographicCamera) {
      const before = c.target.clone();
      c.target.lerp(target.current, 1 - Math.exp(-dt * tweenRate.current));
      camera.position.add(c.target.clone().sub(before));
      camera.zoom = MathUtils.lerp(
        camera.zoom,
        zoomGoal.current,
        1 - Math.exp(-dt * tweenRate.current),
      );
      camera.updateProjectionMatrix();
      c.update();
      tween.current =
        c.target.distanceTo(target.current) > 0.003 ||
        Math.abs(camera.zoom - zoomGoal.current) > 0.05;
      if (tween.current) invalidate();
      else tweenRate.current = 11;
    }
    if (
      props.moving &&
      props.orbiting &&
      !userOrbit.current &&
      !tween.current &&
      c
    ) {
      orbitPhase.current += dt;
      const nextOffset = Math.sin(orbitPhase.current * 0.22) * 0.18;
      c.rotateLeft(nextOffset - orbitOffset.current);
      orbitOffset.current = nextOffset;
      c.update();
    }
    if (body.current) {
      body.current.updateWorldMatrix(true, false);
      const project = (id: string, position: NetworkPoint) => {
        vec
          .set(...position)
          .applyMatrix4(body.current!.matrixWorld)
          .project(camera);
        return {
          id,
          x: ((vec.x + 1) * size.width) / 2,
          y: ((1 - vec.y) * size.height) / 2,
        };
      };
      const projected = props.graph.nodes.map((node) =>
        project(node.id, node.position),
      );
      // Screen-down from the core's centre, past its rim, however the camera turns.
      below.set(0, -0.6, 0).applyQuaternion(camera.quaternion);
      projected.push(project(coreAnchorId, [below.x, below.y, below.z]));
      if (hoveredEdge)
        projected.push(
          project(
            linkChipId,
            hoveredEdge.points[hoveredEdge.points.length >> 1],
          ),
        );
      props.onProject(projected, size.width, size.height);
    }
    if (!props.moving) return;
    time.current += dt;
    const t = time.current;
    // After the head lands, the trail collapses into the node instead of vanishing.
    const drain = trailLength / signalSpeed;
    journeys.current = journeys.current.filter(
      (j) => t - j.started < j.duration + drain,
    );
    const explore: Journey[] = props.exploring
      ? explorationRoutes.map((route, i) => ({
          ...route,
          preview: true,
          duration: 1.5,
          started: t - ((t * 0.35 + i * 0.173) % 1) * 1.5,
        }))
      : [];
    const active = props.exploring ? explore : journeys.current;
    let count = 0;
    /** One comet: a bright head with a tail trailing behind its direction of travel. */
    const comet = (
      points: NetworkPoint[],
      length: number,
      head: number,
      direction: 1 | -1,
      color: Color,
      settled = 0,
    ) => {
      const spacing = (trailLength / trailSamples) * (1 - settled);
      for (let k = 0; k < trailSamples && count < signalCapacity; k++) {
        const distance = head - direction * k * spacing;
        if (distance < 0 || distance > length) break;
        const fade = 1 - k / trailSamples;
        transform.position.set(
          ...pointOnRoute(points, length ? distance / length : 1),
        );
        transform.scale.setScalar((k ? 0.034 : 0.05) * fade ** 0.7);
        transform.updateMatrix();
        signals.current?.setMatrixAt(count, transform.matrix);
        signals.current?.setColorAt(
          count,
          tint.copy(color).multiplyScalar(fade ** 1.6 * (1 - settled * 0.7)),
        );
        count++;
      }
    };
    for (const j of active) {
      const age = (t - j.started) / j.duration;
      if (age >= 1 && !j.arrived && !props.exploring) {
        j.arrived = true;
        arrivals.current.push({
          position: j.points.at(-1) ?? [0, 0, 0],
          started: t,
          color: j.color ?? (j.preview ? previewColor : workerColor),
        });
      }
      const settled = MathUtils.clamp(
          (t - j.started - j.duration) / drain,
          0,
          1,
        ),
        head = ease(Math.min(1, age)) * j.length;
      comet(
        j.points,
        j.length,
        head,
        1,
        j.color ?? (j.preview ? previewColor : workerColor),
        settled,
      );
      // A link click flies the camera along with its comet, then settles on the view.
      if (follow.current === j) {
        if (age >= 1) {
          follow.current = null;
          target.current.copy(viewTarget.current);
        } else if (!userOrbit.current)
          target.current
            .set(...pointOnRoute(j.points, j.length ? head / j.length : 1))
            .multiplyScalar(0.45);
        tween.current = true;
      }
    }
    // Retrying tasks bounce an amber signal along their link until they settle.
    retrying.forEach((r, i) => {
      const swing = (t * 0.7 + i * 0.37) % 2,
        forward = swing < 1;
      comet(
        r.points,
        r.length,
        ease(forward ? swing : 2 - swing) * r.length,
        forward ? 1 : -1,
        retryColor,
      );
    });
    if (signals.current) {
      signals.current.count = count;
      signals.current.instanceMatrix.needsUpdate = true;
      if (signals.current.instanceColor)
        signals.current.instanceColor.needsUpdate = true;
    }
    arrivals.current = arrivals.current.filter(
      (a) => t - a.started < arrivalLife,
    );
    let rings = 0;
    transform.quaternion.copy(camera.quaternion);
    for (const a of arrivals.current) {
      const p = (t - a.started) / arrivalLife;
      transform.position.set(...a.position);
      transform.scale.setScalar(0.06 + (1 - (1 - p) ** 3) * 0.22);
      transform.updateMatrix();
      ripples.current?.setMatrixAt(rings, transform.matrix);
      ripples.current?.setColorAt(
        rings,
        tint.copy(a.color).multiplyScalar((1 - p) ** 2),
      );
      rings++;
    }
    transform.quaternion.identity();
    if (ripples.current) {
      ripples.current.count = rings;
      ripples.current.instanceMatrix.needsUpdate = true;
      if (ripples.current.instanceColor)
        ripples.current.instanceColor.needsUpdate = true;
    }
    if (pipeline?.active && props.working && t >= nextPipe.current) {
      nextPipe.current = t + pipeline.interval * (0.6 + Math.random() * 0.8);
      const out = along(
        pipeline.search,
        [
          pipeline.search[0] * 0.45 + (Math.random() - 0.5) * 0.4,
          pipeline.search[1] * 0.45 + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.6,
        ],
        1.6,
      );
      const inbound = curvedLink(out, pipeline.search, "branch"),
        head = [...inbound, ...pipeline.toVerify.slice(1)],
        rejected = Math.random() < pipeline.reject,
        tail = rejected
          ? [along(pipeline.verify, [0.12, -1, 0.15], 1.05)]
          : pipeline.toQueue.slice(1),
        points = [...head, ...tail];
      addFx({
        points,
        life: rejected ? 2.9 : 3.4,
        color: pipeColor,
        size: 0.042,
        fade: rejected ? "drop" : "travel",
        fadeFrom: routeLength(head) / routeLength(points),
      });
    }
    effects.current = effects.current.filter((e) => t - e.start < e.life);
    let sparks = 0;
    for (const e of effects.current) {
      const f = (t - e.start) / e.life;
      if (f < 0) continue;
      const a = fxAlpha(e, f);
      transform.position.set(...pointOnRoute(e.points, e.ease ? e.ease(f) : f));
      transform.scale.setScalar(e.size * (0.6 + 0.4 * a));
      transform.updateMatrix();
      fx.current?.setMatrixAt(sparks, transform.matrix);
      fx.current?.setColorAt(sparks, tint.copy(e.color).multiplyScalar(a));
      if (++sparks >= fxCapacity) break;
    }
    if (fx.current) {
      fx.current.count = sparks;
      fx.current.instanceMatrix.needsUpdate = true;
      if (fx.current.instanceColor) fx.current.instanceColor.needsUpdate = true;
    }
  });
  const handleHover = (id: string | null) => {
    gl.domElement.style.cursor = id ? "pointer" : "grab";
    props.onHover(id);
  };
  const pickEdge = (edge: SemanticEdge) => {
    const node = props.graph.nodes.find((n) => n.id === edge.target);
    if (props.moving) {
      const route = journey(
        `follow:${edge.id}:${time.current}`,
        signalRoute(props.graph, {
          id: edge.id,
          stage: edge.stage,
          taskId: edge.taskId,
          back: false,
        }),
        time.current,
        true,
      );
      journeys.current.push(route);
      follow.current = route;
      invalidate();
    }
    if (node) props.onPick(node);
  };
  return (
    <group ref={body}>
      <NeuralAtmosphere
        neuronCount={props.neuronCount}
        focus={props.graph.nodes
          .filter((n) => n.kind === "stage")
          .findIndex((n) => n.stage === focusedStage)}
        moving={props.moving}
        pulseToken={props.pulseToken}
        exploring={props.exploring || props.tracing}
        visible={props.tissue}
        activity={idle ? 0 : 1}
        activeStage={activeStage}
        alarm={alarm}
        coreLight={coreLight}
        bootAt={bootAt}
        shockToken={finishToken}
      />
      {props.graph.edges.map((edge) => (
        <SemanticLink
          key={edge.id}
          edge={edge}
          highlight={
            edge.id === props.hovered ||
            (!!focusedTask && edge.taskId === focusedTask) ||
            (edge.kind === "primary" && edge.stage === focusedStage) ||
            edge.stage === spotlight
          }
          moving={props.moving}
          idle={idle}
          light={coreLight}
          traceAt={traceAt}
          traceDelay={traceOrder.get(edge.id) ?? null}
          bootAt={bootAt}
          bootDelay={bootDelayFor(
            edge.stage,
            edge.kind === "branch" ? 0.3 : edge.kind === "result" ? 0.55 : 0,
          )}
          finishAt={finishAt}
          phase={stageOrder.indexOf(edge.stage) * 1.3}
          state={stateOf.get(edge.target) ?? "recorded"}
          dim={
            (!!spotlight && edge.stage !== spotlight) ||
            (!!focusedTask && edge.stage !== focusedStage) ||
            (!!focusedTask &&
              edge.kind !== "primary" &&
              edge.taskId !== focusedTask)
          }
          onHover={handleHover}
          onPick={() => pickEdge(edge)}
        />
      ))}
      {props.graph.nodes
        .filter((n) => n.kind !== "core")
        .map((node) => (
          <TaskNeuron
            key={node.id}
            node={node}
            selected={
              node.id === props.hovered ||
              (node.kind === "task" && node.taskId === focusedTask)
            }
            moving={props.moving}
            light={coreLight}
            beat={beats.get(node.id) ?? 0}
            bootAt={bootAt}
            bootDelay={bootDelayFor(
              node.stage,
              node.kind === "stage" ? 0.3 : node.kind === "result" ? 0.85 : 0.6,
            )}
            onPick={() => props.onPick(node)}
            onDouble={
              node.kind === "stage" && node.stage
                ? () => props.onZoomStage(node.stage!)
                : undefined
            }
            onHover={handleHover}
          />
        ))}
      <ScoutCore
        appearance={props.coreAppearance}
        moving={props.moving}
        signals={props.activitySignals}
        pulseToken={props.pulseToken}
        onPulse={props.onPulse}
        light={coreLight}
        finishToken={finishToken}
      />
      <instancedMesh
        ref={signals}
        args={[undefined, undefined, signalCapacity]}
        count={0}
        raycast={() => {}}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial
          toneMapped={false}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </instancedMesh>
      <instancedMesh
        ref={fx}
        args={[undefined, undefined, fxCapacity]}
        count={0}
        raycast={() => {}}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial
          toneMapped={false}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </instancedMesh>
      <instancedMesh
        ref={ripples}
        args={[undefined, undefined, 32]}
        count={0}
        raycast={() => {}}
      >
        <ringGeometry args={[0.82, 1, 48]} />
        <meshBasicMaterial
          toneMapped={false}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </instancedMesh>
    </group>
  );
}
export default function NeuralScene(props: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) =>
      setOnScreen(entry.isIntersecting),
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={root}
      className="neural-scene-root"
      style={{ width: "100%", height: "100%" }}
    >
      <Canvas
        orthographic
        camera={{ position: [0, 0.4, 9], zoom: 60, near: 0.1, far: 40 }}
        dpr={[1, 1.5]}
        // Full display frame rate while animating; otherwise draw only on change.
        frameloop={props.moving && onScreen ? "always" : "demand"}
        flat
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        fallback={props.fallback}
        onPointerMissed={() => props.onHover(null)}
        aria-hidden="true"
      >
        <Scene {...props} moving={props.moving && onScreen} />
      </Canvas>
    </div>
  );
}
