import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Lightweight ambient background for the premium auth/portal pages (Login,
// EmployeeLogin, RegisterDevice, EmployeeAttendance, EmployeeHome, ForgotPassword,
// ResetPassword) — a few slowly drifting soft blobs, no interaction, no
// labels. Modeled on the Canvas/useFrame pattern in three/FlightPath.tsx but
// deliberately simpler/cheaper since it's mounted full-bleed behind page
// content rather than in a bounded demo panel.
const BLOBS: { pos: [number, number, number]; scale: number; color: string; speed: number }[] = [
  { pos: [-3.2, 1.2, -2], scale: 1.6, color: '#7B5CFA', speed: 0.6 },
  { pos: [3.4, -1.0, -3], scale: 2.1, color: '#22C7B8', speed: 0.45 },
  { pos: [0.6, 2.0, -4], scale: 1.3, color: '#F5B94D', speed: 0.7 },
  { pos: [-2.0, -1.8, -2.5], scale: 1.1, color: '#7B5CFA', speed: 0.5 },
];

function Blob({ pos, scale, color, speed }: (typeof BLOBS)[number]) {
  const ref = useRef<THREE.Mesh>(null);
  const base = useRef(pos);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() * speed;
    ref.current.position.x = base.current[0] + Math.sin(t) * 0.4;
    ref.current.position.y = base.current[1] + Math.cos(t * 0.8) * 0.3;
    ref.current.rotation.y += 0.0015;
    ref.current.rotation.x += 0.0008;
  });

  return (
    <mesh ref={ref} position={pos} scale={scale}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} transparent opacity={0.16} />
    </mesh>
  );
}

export default function AuroraField({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`} aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 1.5]}>
        <ambientLight intensity={1.4} />
        <pointLight position={[4, 4, 4]} intensity={0.8} color="#7B5CFA" />
        {BLOBS.map((b, i) => <Blob key={i} {...b} />)}
      </Canvas>
    </div>
  );
}
