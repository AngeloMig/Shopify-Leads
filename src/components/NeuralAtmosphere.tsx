import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  AdditiveBlending,
  Color,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { buildNetwork, clusterCenters } from "./research-network-model";
import type { CoreLight } from "./ScoutCore";

const burstSlots = 8,
  burstLife = 1.6;

const vertex = `
attribute float neuronSize;
attribute float along;
attribute float seed;
varying float vFocus;
varying float vDistance;
varying float vAlong;
varying float vSeed;
varying float vFade;
varying vec3 vPosition;
uniform float pixelRatio;
uniform vec3 focusCenter;
void main() {
  // Focus fades out from the stage hub instead of lighting a hard quadrant.
  vFocus = 1.0 - smoothstep(0.25, 1.55, distance(position, focusCenter));
  vDistance = length(position.xy);
  vAlong = along;
  vSeed = seed;
  vPosition = position;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  // Depth fog dims the far side of the brain; the vignette fades it into the edges.
  float fog = smoothstep(8.3, 10.4, -view.z);
  float edge = length(gl_Position.xy / gl_Position.w * vec2(1.0, 1.15));
  vFade = mix(1.0, 0.45, fog) * (1.0 - smoothstep(0.78, 1.18, edge));
  gl_PointSize = clamp(neuronSize * pixelRatio, 1.0, 18.0);
}`;
const fragment = `
uniform float time;
uniform float focus;
uniform float wave;
uniform float exploration;
uniform float points;
uniform float density;
uniform float activity;
uniform float coreLight;
uniform vec3 coreColor;
uniform float bootAge;
uniform float shock;
uniform vec4 bursts[${burstSlots}];
varying float vFocus;
varying float vDistance;
varying float vAlong;
varying float vSeed;
varying float vFade;
varying vec3 vPosition;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float regionMatch = focus < 0.0 ? 0.0 : vFocus;
  float emphasis = focus < 0.0 ? 0.88 : mix(0.62, 1.0, regionMatch);
  float sweep = exploration > 0.5 && wave < 0.0 ? mod(time * 0.75, 4.8) : wave;
  float front = 1.0 - smoothstep(0.0, 0.36, abs(vDistance - sweep));
  float energy = front * step(0.0, sweep);
  // Boot: the brain powers up from the core outward behind a bright front.
  float bootOn = step(bootAge, 3.2);
  float bootDist = length(vPosition);
  float reveal = bootAge * 1.6;
  float shown = mix(1.0, smoothstep(reveal, reveal - 0.45, bootDist) * 0.92 + 0.08, bootOn);
  energy = max(energy, bootOn * exp(-pow((bootDist - reveal) / 0.14, 2.0)));
  // Finish shockwave rides the same front, stronger and green.
  energy *= 1.0 + shock;

  // Brain-like firing. Scattered sparks: each synapse occasionally fires a short
  // pulse along its length; firing is busier while work runs.
  float rate = mix(0.1, 0.25, activity);
  float cycle = time * rate + vSeed * 17.0;
  float fires = step(1.0 - mix(0.02, 0.05, activity), hash(vSeed * 91.7 + floor(cycle)));
  float head = fract(cycle) / (rate * 0.35);
  float spark = points > 0.5
    ? fires * (1.0 - smoothstep(0.0, 1.0, head)) * step(0.0, 1.0 - head)
    : fires * exp(-pow((vAlong - head) * 9.0, 2.0));
  // Cascades: a firing front spreads out from a burst point through about half
  // the nearby synapses, then dies away.
  float cascade = 0.0;
  for (int i = 0; i < ${burstSlots}; i++) {
    float age = time - bursts[i].w;
    if (age < 0.0 || age > ${burstLife.toFixed(1)}) continue;
    float dist = distance(vPosition, bursts[i].xyz);
    float ring = exp(-pow((dist - age * 1.05) / 0.14, 2.0));
    cascade += ring * (1.0 - age / ${burstLife.toFixed(1)}) * (1.0 - smoothstep(0.9, 1.45, dist));
  }
  cascade *= step(0.45, fract(vSeed * 13.1));
  float firing = min(1.0, spark + cascade);
  // Light thrown off the spinning core falls on the neurons around it.
  float spill = coreLight * exp(-dot(vPosition, vPosition) / 1.1);

  vec3 base = mix(vec3(0.25, 0.48, 0.53), vec3(0.43, 0.79, 0.70), regionMatch);
  vec3 signal = mix(vec3(0.67, 1.0, 0.86), vec3(0.37, 0.80, 0.94), exploration);
  signal = mix(signal, vec3(0.5, 0.95, 0.72), shock);
  vec3 fire = vec3(0.55, 0.95, 0.85);
  float alpha = mix(mix(0.13, 0.045, density), mix(0.7, 0.48, density), points) * emphasis;
  if (points > 0.5) {
    float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float halo = exp(-radius * radius * 5.0);
    alpha *= halo;
    alpha += energy * halo * 0.45;
    alpha += firing * halo * 0.6;
    alpha += spill * halo * 0.55;
  } else {
    alpha += energy * mix(0.2, 0.075, density);
    // Background firing stays well below real task signals.
    alpha += firing * 0.4;
    alpha += spill * 0.2;
  }
  vec3 color = mix(mix(mix(base, coreColor, min(1.0, spill * 0.8)), fire, firing), signal, energy);
  gl_FragColor = vec4(color, alpha * vFade * shown);
}`;
/**
 * Water: faint caustic light drifting behind everything, drawn in screen space so
 * it stays put while the brain orbits.
 */
const waterVertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.9999, 1.0);
}`;
const waterFragment = `
uniform float time;
uniform vec2 resolution;
uniform float shockAge;
varying vec2 vUv;
float caustic(vec2 p, float t) {
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    p += vec2(
      sin(p.y * 1.3 + t * 0.9 + fi * 1.7),
      cos(p.x * 1.1 - t * 0.7 + fi * 2.3)
    ) * 0.42;
  }
  // Soft falloff so it reads as light through water rather than drawn lines.
  return exp(-abs(sin(p.x) + sin(p.y)) * 3.5);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  // Finish shockwave: one expanding ripple bends the water as it passes.
  float ripple = 0.0;
  if (shockAge >= 0.0) {
    float d = length(p);
    ripple = exp(-pow((d - shockAge * 0.6) / 0.07, 2.0)) * exp(-shockAge * 0.8);
    p += p / max(d, 0.001) * ripple * 0.06;
  }
  float t = time * 0.1;
  float light = caustic(p * 4.2, t) * 0.6 + caustic(p * 7.0 + 3.1, t * 1.3) * 0.4;
  // Two pools of light drifting on long, slow loops, like a dream.
  vec2 a = vec2(sin(t * 0.7) * 0.45, cos(t * 0.5) * 0.25);
  vec2 b = vec2(cos(t * 0.43 + 2.0) * 0.5, sin(t * 0.61 + 1.0) * 0.3);
  float poolA = exp(-dot(p - a, p - a) * 5.0);
  float poolB = exp(-dot(p - b, p - b) * 6.0);
  // A long swell so the water feels deep rather than busy.
  float swell = 0.5 + 0.5 * sin(p.x * 1.4 + p.y * 0.8 + t * 0.6);
  float mask = 1.0 - smoothstep(0.35, 1.05, length(p * vec2(0.8, 1.0)));
  vec3 teal = vec3(0.45, 0.85, 0.82), blue = vec3(0.42, 0.62, 0.95);
  vec3 color = mix(teal, blue, 0.5 + 0.5 * sin(t * 0.8 + p.x * 1.2 - p.y));
  color = mix(color, blue, poolB * 0.6);
  float alpha = light * 0.07 + swell * 0.02 + poolA * 0.05 + poolB * 0.045 + ripple * 0.08;
  gl_FragColor = vec4(color, alpha * mask);
}`;
const glowVertex = `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const glowFragment = `varying vec2 vUv; uniform vec3 color; void main(){float r=length(vUv-.5)*2.; gl_FragColor=vec4(color,exp(-r*r*6.)*.18);}`;

/** Deterministic random numbers so firing seeds are stable between renders. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Contextual tissue is visual structure; semantic task nodes carry all data. */
export default function NeuralAtmosphere({
  focus,
  neuronCount,
  moving,
  pulseToken,
  exploring,
  visible,
  activity,
  activeStage,
  alarm,
  coreLight,
  bootAt = 0,
  shockToken = 0,
}: {
  focus: number;
  neuronCount: number;
  moving: boolean;
  pulseToken: number;
  exploring: boolean;
  visible: boolean;
  /** 0 when idle, 1 while work runs; sets how busy the background firing is. */
  activity: number;
  /** Stage index cascades gather around while it runs, or -1. */
  activeStage: number;
  /** Increments when a task fails, setting off a burst near the active stage. */
  alarm: number;
  coreLight?: { current: CoreLight };
  /** Boot sequence start (seconds, performance clock). */
  bootAt?: number;
  /** Increments when a whole run finishes. */
  shockToken?: number;
}) {
  const { gl, invalidate, size } = useThree();
  const clock = useRef(0),
    wave = useRef(-1),
    nextBurst = useRef(0.6),
    burstIndex = useRef(0),
    random = useRef(seeded(7)),
    halo = useRef<Mesh>(null);
  const geometry = useMemo(() => {
    const graph = buildNetwork(neuronCount);
    const rand = seeded(neuronCount);
    const points = new Float32Array(graph.points.length * 3);
    const sizes = new Float32Array(graph.points.length);
    const pointSeeds = new Float32Array(graph.points.length);
    const edges = new Float32Array(graph.edges.length * 6);
    const along = new Float32Array(graph.edges.length * 2);
    const edgeSeeds = new Float32Array(graph.edges.length * 2);
    const byCluster: number[][] = [[], [], [], []];
    graph.points.forEach((point, i) => {
      points.set(point.position, i * 3);
      sizes[i] = point.size;
      pointSeeds[i] = rand();
      if (!point.anchor) byCluster[point.cluster].push(i);
    });
    graph.edges.forEach((edge, i) => {
      edges.set(edge.from, i * 6);
      edges.set(edge.to, i * 6 + 3);
      along[i * 2 + 1] = 1;
      edgeSeeds[i * 2] = edgeSeeds[i * 2 + 1] = rand();
    });
    return { points, sizes, pointSeeds, edges, along, edgeSeeds, byCluster };
  }, [neuronCount]);
  const materials = useMemo(
    () =>
      [0, 1].map(
        (points) =>
          new ShaderMaterial({
            vertexShader: vertex,
            fragmentShader: fragment,
            uniforms: {
              time: { value: 0 },
              focus: { value: -1 },
              focusCenter: { value: new Vector3() },
              wave: { value: -1 },
              exploration: { value: 0 },
              points: { value: points },
              density: { value: 1 },
              pixelRatio: { value: 1 },
              activity: { value: 0 },
              coreLight: { value: 0 },
              bootAge: { value: 99 },
              shock: { value: 0 },
              coreColor: { value: new Color("#83ffe0") },
              bursts: {
                value: Array.from(
                  { length: burstSlots },
                  () => new Vector4(0, 0, 0, -100),
                ),
              },
            },
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
          }),
      ),
    [],
  );
  const waterMaterial = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: waterVertex,
        fragmentShader: waterFragment,
        uniforms: {
          time: { value: 0 },
          resolution: { value: new Vector2() },
          shockAge: { value: -1 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  const glow = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { color: { value: new Color("#67d9bd") } },
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  useEffect(
    () => () => {
      materials.forEach((m) => m.dispose());
      waterMaterial.dispose();
      glow.dispose();
    },
    [materials, waterMaterial, glow],
  );
  useEffect(() => {
    for (const m of materials) {
      m.uniforms.density.value = Math.min(1, neuronCount / 10000);
      m.uniforms.focus.value = focus;
      if (focus >= 0)
        m.uniforms.focusCenter.value.set(...clusterCenters[focus]);
      m.uniforms.exploration.value = exploring ? 1 : 0;
      m.uniforms.pixelRatio.value = gl.getPixelRatio();
    }
    waterMaterial.uniforms.resolution.value.set(size.width, size.height);
    invalidate();
  }, [
    materials,
    waterMaterial,
    focus,
    exploring,
    neuronCount,
    size,
    gl,
    invalidate,
  ]);
  useEffect(() => {
    if (pulseToken) wave.current = 0;
  }, [pulseToken]);
  const shockStart = useRef(-10);
  useEffect(() => {
    if (!shockToken || !moving) return;
    shockStart.current = clock.current;
    wave.current = 0;
  }, [shockToken, moving]);
  const fireBurst = (stage: number) => {
    const pool =
      stage >= 0 && random.current() < 0.7
        ? geometry.byCluster[stage]
        : geometry.byCluster[Math.floor(random.current() * 4)];
    if (!pool.length) return;
    const i = pool[Math.floor(random.current() * pool.length)];
    for (const m of materials)
      m.uniforms.bursts.value[burstIndex.current % burstSlots].set(
        geometry.points[i * 3],
        geometry.points[i * 3 + 1],
        geometry.points[i * 3 + 2],
        clock.current,
      );
    burstIndex.current++;
  };
  const fireRef = useRef(fireBurst);
  fireRef.current = fireBurst;
  useEffect(() => {
    if (!alarm || !moving) return;
    for (let i = 0; i < 3; i++) fireRef.current(activeStage);
  }, [alarm, moving, activeStage]);
  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.08);
    if (moving) {
      clock.current += dt;
      if (wave.current >= 0) {
        wave.current += dt * 1.7;
        if (wave.current > 3.8) wave.current = -1;
      }
      // Cascades: an occasional burst when idle, frequent near the running stage.
      if (clock.current >= nextBurst.current) {
        fireRef.current(activeStage);
        nextBurst.current =
          clock.current +
          (activity > 0.5 ? 0.35 : 1.2) +
          random.current() * (activity > 0.5 ? 0.4 : 1.4);
      }
      for (const m of materials)
        m.uniforms.activity.value +=
          (activity - m.uniforms.activity.value) * (1 - Math.exp(-dt * 1.5));
    }
    for (const m of materials) {
      m.uniforms.time.value = clock.current;
      m.uniforms.wave.value = wave.current;
      if (coreLight) {
        m.uniforms.coreLight.value = coreLight.current.intensity;
        m.uniforms.coreColor.value.copy(coreLight.current.color);
      }
    }
    waterMaterial.uniforms.time.value = clock.current;
    const sinceShock = clock.current - shockStart.current;
    waterMaterial.uniforms.shockAge.value =
      sinceShock >= 0 && sinceShock < 4 ? sinceShock : -1;
    const bootAge = moving ? performance.now() / 1000 - bootAt : 99;
    for (const m of materials) {
      m.uniforms.bootAge.value = bootAge;
      m.uniforms.shock.value = Math.max(0, 1 - sinceShock / 3);
    }
    halo.current?.quaternion.copy(camera.quaternion);
  });
  return (
    <group>
      <mesh raycast={() => {}} renderOrder={-1} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <primitive object={waterMaterial} attach="material" />
      </mesh>
      <group visible={visible}>
        <lineSegments raycast={() => {}}>
          <bufferGeometry key={neuronCount}>
            <bufferAttribute
              attach="attributes-position"
              args={[geometry.edges, 3]}
            />
            <bufferAttribute
              attach="attributes-along"
              args={[geometry.along, 1]}
            />
            <bufferAttribute
              attach="attributes-seed"
              args={[geometry.edgeSeeds, 1]}
            />
          </bufferGeometry>
          <primitive object={materials[0]} attach="material" />
        </lineSegments>
        <points raycast={() => {}}>
          <bufferGeometry key={neuronCount}>
            <bufferAttribute
              attach="attributes-position"
              args={[geometry.points, 3]}
            />
            <bufferAttribute
              attach="attributes-neuronSize"
              args={[geometry.sizes, 1]}
            />
            <bufferAttribute
              attach="attributes-seed"
              args={[geometry.pointSeeds, 1]}
            />
          </bufferGeometry>
          <primitive object={materials[1]} attach="material" />
        </points>
      </group>
      <mesh ref={halo} raycast={() => {}}>
        <planeGeometry args={[2.8, 2.8]} />
        <primitive object={glow} attach="material" />
      </mesh>
    </group>
  );
}
