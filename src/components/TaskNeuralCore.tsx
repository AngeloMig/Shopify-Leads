import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, Group } from "three";
function Core({ moving }: { moving: boolean }) {
  const group = useRef<Group>(null),
    phase = useRef(0),
    { invalidate } = useThree();
  const geometry = useMemo(() => {
    const points = Array.from({ length: 72 }, (_, i) => {
      const y = 1 - (i / 71) * 2,
        r = Math.sqrt(1 - y * y),
        a = i * 2.399963;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    });
    const lines: number[] = [];
    points.forEach((p, i) =>
      points
        .map((q, j) => ({
          j,
          d: q.reduce((n, v, k) => n + (v - p[k]) ** 2, 0),
        }))
        .filter((q) => q.j > i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .forEach((q) => lines.push(...p, ...points[q.j])),
    );
    return new BufferGeometry().setAttribute(
      "position",
      new Float32BufferAttribute(lines, 3),
    );
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    invalidate();
    if (!moving) return;
    const timer = setInterval(invalidate, 1000 / 30);
    return () => clearInterval(timer);
  }, [moving, invalidate]);
  useFrame((_, delta) => {
    if (!moving || !group.current) return;
    phase.current += Math.min(delta, 0.05);
    group.current.rotation.y = phase.current * 0.12;
    group.current.rotation.z = 0.1;
    group.current.scale.setScalar(1 + Math.sin(phase.current * 1.9) * 0.035);
  });
  return (
    <group ref={group}>
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color="#a2ffe2" transparent opacity={0.65} />
      </lineSegments>
      <mesh>
        <icosahedronGeometry args={[0.67, 2]} />
        <meshBasicMaterial
          wireframe
          color="#7bd9c0"
          transparent
          opacity={0.2}
        />
      </mesh>
    </group>
  );
}
export default function TaskNeuralCore({ moving }: { moving: boolean }) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 3.5], fov: 44 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
    >
      <Core moving={moving} />
    </Canvas>
  );
}
