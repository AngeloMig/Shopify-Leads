import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  Color,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Vector3,
} from "three";
import type { ActivitySignal } from "./neural-task-graph";
import {
  coreEnergy,
  corePalettes,
  coreStates,
  stepCoreDrive,
  type CoreAppearance,
} from "./scout-core-model";

/** Core light shared with the scene, so nearby neurons, links and nodes pick it up. */
export type CoreLight = { intensity: number; color: Color };
const angles = [
  [0.3, 0, 0],
  [1.15, 0.7, 1.05],
  [2, 1.4, 2.1],
] as const;
/**
 * Each beam keeps a bright head; the faster it spins the more its tail fades into
 * a streak, and the outermost layer adds emitted light at high speed.
 */
const beamFragment = `
uniform vec3 tint;
uniform float arc;
uniform float alpha;
uniform float dir;
uniform float trail;
varying vec2 vUv;
void main() {
  if (vUv.x > arc) discard;
  float head = dir > 0.0 ? vUv.x / arc : 1.0 - vUv.x / arc;
  gl_FragColor = vec4(tint, alpha * mix(1.0 - trail, 1.0, pow(head, 1.5)));
}`;
function Beam({
  index,
  drive,
  flare,
  color,
  moving,
}: {
  index: number;
  drive: { current: number };
  /** 0–1 burst when a task lands at the core. */
  flare: { current: number };
  color: string;
  moving: boolean;
}) {
  const track = useRef<Group>(null);
  const direction = index % 2 ? -1 : 1;
  const layers = useMemo(
    () =>
      [0.005, 0.012, 0.028, 0.06].map((width, i) => ({
        width,
        material: new ShaderMaterial({
          uniforms: {
            tint: { value: new Color(color) },
            arc: { value: 0.65 },
            alpha: { value: 0.55 / (i + 1) },
            dir: { value: direction },
            trail: { value: 0 },
          },
          vertexShader:
            "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
          fragmentShader: beamFragment,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          toneMapped: false,
        }),
      })),
    [],
  );
  const target = useMemo(() => new Color(color), [color]);
  const white = useMemo(() => new Color("#ffffff"), []);
  useEffect(() => () => layers.forEach((l) => l.material.dispose()), [layers]);
  useFrame((_, delta) => {
    const energy = coreEnergy(drive.current),
      burst = flare.current;
    if (moving && track.current)
      track.current.rotation.z +=
        Math.min(delta, 0.08) * (0.22 + energy * (18 + index * 3)) * direction;
    layers.forEach(({ material }, i) => {
      material.uniforms.arc.value = 0.65 + 0.35 * energy;
      material.uniforms.trail.value = energy * 0.85;
      // Faster spin emits more light; the wide outer layer only shows at speed.
      material.uniforms.alpha.value =
        i === 0
          ? 0.6 + energy * 0.4 + burst * 0.3
          : i === 3
            ? energy * energy * 0.14 + burst * 0.12
            : (0.08 + energy * 0.24 + burst * 0.15) / i;
      material.uniforms.tint.value
        .copy(target)
        .lerp(
          white,
          Math.min(1, (i === 0 ? energy * 0.85 : energy * 0.2) + burst * 0.4),
        );
    });
  });
  return (
    <group rotation={[...angles[index]]}>
      <group ref={track}>
        {layers.map(({ width, material }, i) => (
          <mesh key={i} material={material} raycast={() => {}}>
            <torusGeometry args={[0.64, width, 5, 96]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
/** Core motion is a visual response to execution; collisions never represent a finding. */
export default function ScoutCore({
  appearance,
  moving,
  signals,
  pulseToken,
  onPulse,
  light,
  finishToken = 0,
}: {
  appearance: CoreAppearance;
  moving: boolean;
  signals: ActivitySignal[];
  pulseToken: number;
  onPulse: () => void;
  light?: { current: CoreLight };
  /** Increments when a whole run finishes: the core contracts, then releases. */
  finishToken?: number;
}) {
  const { invalidate, camera } = useThree();
  const outer = useRef<Group>(null),
    core = useRef<Mesh>(null),
    inner = useRef<Mesh>(null),
    burst = useRef<Group>(null),
    halo = useRef<Mesh>(null);
  const drive = useRef(0),
    flare = useRef(0),
    finishAt = useRef(-10),
    lastFinish = useRef(finishToken),
    time = useRef(0),
    arrival = useRef(-10),
    nextCollision = useRef(0),
    collisionAt = useRef(-10);
  const seen = useRef<Set<string> | null>(null),
    lastPulse = useRef(pulseToken);
  const colors = corePalettes.find((p) => p.id === appearance.palette)!.colors;
  const working = appearance.working;
  const stateColor = coreStates[appearance.state].color;
  const lightColor = useMemo(() => new Color(colors[0]), [colors]),
    white = useMemo(() => new Color("#ffffff"), []);
  const markerRefs = useRef<(Mesh | null)[]>([]),
    blooms = useRef([-10, -10, -10, -10]);
  const evidence = appearance.evidence
    .map((e) => (e.ready ? "1" : "0"))
    .join("");
  const previousEvidence = useRef(evidence);
  const crossings = useMemo(
    () =>
      angles
        .map((a) => new Vector3(0, 0, 1).applyEuler(new Euler(...a)))
        .map((normal, i, all) =>
          normal
            .clone()
            .cross(all[(i + 1) % 3])
            .normalize()
            .multiplyScalar(0.64),
        ),
    [],
  );
  useEffect(() => {
    if (previousEvidence.current !== evidence)
      appearance.evidence.forEach((e, i) => {
        if (e.ready && previousEvidence.current[i] !== "1")
          blooms.current[i] = time.current;
      });
    // Keep booleans in a fixed-width string so absent evidence never shifts another marker.
    previousEvidence.current = evidence;
    invalidate();
  }, [evidence, appearance.evidence, invalidate]);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(signals.map((s) => s.id));
      return;
    }
    signals.forEach((s) => {
      if (!seen.current!.has(s.id) && s.back && moving)
        arrival.current = time.current + 1.35;
      seen.current!.add(s.id);
    });
    // Events are bounded by the retained stream; avoid an unbounded set in long sessions.
    if (seen.current.size > 256)
      seen.current = new Set(signals.map((s) => s.id));
    invalidate();
  }, [signals, moving, invalidate]);
  useEffect(() => {
    if (pulseToken !== lastPulse.current && moving)
      arrival.current = time.current;
    lastPulse.current = pulseToken;
    invalidate();
  }, [pulseToken, moving, invalidate]);
  useEffect(() => {
    if (finishToken !== lastFinish.current && moving)
      finishAt.current = time.current;
    lastFinish.current = finishToken;
  }, [finishToken, moving]);
  useEffect(
    () => invalidate(),
    [appearance.state, appearance.palette, invalidate],
  );
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.08);
    if (moving) {
      time.current += dt;
      drive.current = stepCoreDrive(drive.current, working, dt);
    }
    const t = time.current,
      energy = coreEnergy(drive.current),
      age = t - arrival.current;
    const intake = age >= 0 && age < 1 ? Math.sin(age * Math.PI) : 0;
    // Finish: 0.35s contraction, then a release that overshoots and settles.
    const k = t - finishAt.current,
      squeeze = k >= 0 && k < 0.35 ? Math.sin((k / 0.35) * (Math.PI / 2)) : 0,
      release =
        k >= 0.35 && k < 1.2 ? Math.sin(((k - 0.35) / 0.85) * Math.PI) : 0;
    flare.current = Math.max(intake, release);
    if (light) {
      light.current.intensity = Math.min(
        1.6,
        energy ** 1.5 * 0.9 + intake * 0.6 + release * 0.9,
      );
      light.current.color.copy(lightColor).lerp(white, energy * 0.4);
    }
    if (moving && core.current && inner.current && outer.current) {
      core.current.rotation.x += dt * (0.05 + energy * 0.48);
      core.current.rotation.y += dt * (0.12 + energy * 1.15);
      core.current.rotation.z = Math.sin(t * 1.4) * 0.16 * energy;
      inner.current.rotation.x -= dt * (0.2 + energy * 1.5);
      inner.current.rotation.z += dt * (0.14 + energy * 0.9);
      outer.current.position.set(
        Math.sin(t * 2.4) * 0.045 * energy,
        Math.cos(t * 3.1) * 0.055 * energy,
        0,
      );
      outer.current.rotation.y += dt * (0.08 + energy * 0.35);
      core.current.scale.setScalar(
        (1 + Math.sin(t * 2.1) * (0.02 + energy * 0.04) + intake * 0.12) *
          (1 - squeeze * 0.28 + release * 0.22),
      );
      if (energy > 0.985 && working && t >= nextCollision.current) {
        collisionAt.current = t;
        nextCollision.current = t + 1.3 + Math.random() * 1.7;
        const at = crossings[Math.floor(Math.random() * crossings.length)]
          .clone()
          .multiplyScalar(Math.random() > 0.5 ? 1 : -1);
        burst.current?.position.copy(at);
      }
    }
    if (burst.current) {
      const life = (t - collisionAt.current) / 1.1;
      burst.current.visible = life >= 0 && life < 1;
      burst.current.quaternion.copy(camera.quaternion);
      burst.current.scale.setScalar(0.25 + Math.max(0, life) * 2);
      burst.current.children.forEach((child) => {
        ((child as Mesh).material as MeshBasicMaterial).opacity =
          Math.max(0, 1 - life) * 0.65;
      });
    }
    if (halo.current) {
      halo.current.quaternion.copy(camera.quaternion);
      // The halo stays put on a pulse; only the core and tissue react.
      (halo.current.material as MeshBasicMaterial).opacity =
        0.05 + energy * 0.05;
    }
    markerRefs.current.forEach((mesh, i) => {
      if (mesh)
        mesh.scale.setScalar(
          1 + Math.max(0, 1 - (t - blooms.current[i]) / 1.2) * 0.8,
        );
    });
  });
  return (
    <group ref={outer}>
      <mesh
        ref={core}
        onClick={(e) => {
          if (e.delta < 5) {
            e.stopPropagation();
            onPulse();
          }
        }}
      >
        <icosahedronGeometry args={[0.4, 2]} />
        <meshBasicMaterial
          wireframe
          color={stateColor}
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={inner} raycast={() => {}}>
        <icosahedronGeometry args={[0.27, 1]} />
        <meshBasicMaterial
          wireframe
          color={colors[0]}
          transparent
          opacity={0.3}
        />
      </mesh>
      {[0, 1, 2].map((i) => (
        <Beam
          key={i}
          index={i}
          drive={drive}
          flare={flare}
          color={colors[i]}
          moving={moving}
        />
      ))}
      <mesh ref={halo} raycast={() => {}}>
        <ringGeometry args={[0.43, 0.48, 64]} />
        <meshBasicMaterial
          color={stateColor}
          transparent
          opacity={0.1}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <group ref={burst} visible={false} raycast={() => {}}>
        <mesh>
          <ringGeometry args={[0.05, 0.065, 24]} />
          <meshBasicMaterial
            color={colors[2]}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
        <mesh rotation={[0, 0, 0.7]}>
          <planeGeometry args={[0.2, 0.012]} />
          <meshBasicMaterial
            color={colors[2]}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
        <mesh rotation={[0, 0, -0.7]}>
          <planeGeometry args={[0.2, 0.012]} />
          <meshBasicMaterial
            color={colors[2]}
            transparent
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </mesh>
      </group>
      {appearance.evidence.map((e, i) => {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        return (
          <group
            key={e.id}
            position={[Math.cos(a) * 0.83, Math.sin(a) * 0.83, 0]}
          >
            <mesh
              ref={(m) => {
                markerRefs.current[i] = m;
              }}
              raycast={() => {}}
            >
              <octahedronGeometry args={[e.ready ? 0.045 : 0.027, 0]} />
              <meshBasicMaterial
                color={e.ready ? colors[0] : "#8d774c"}
                transparent
                opacity={e.ready ? 0.95 : 0.3}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
