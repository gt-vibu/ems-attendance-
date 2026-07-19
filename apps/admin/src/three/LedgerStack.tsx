/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

// Signature hero visual for the rebuilt landing page: a slowly auto-rotating,
// pointer-parallaxed helical stack of translucent glass "cards", each one
// standing in for a product surface (attendance / leave / payroll /
// directory). Replaces the old PerimeterField geofence-dome background —
// deliberately not a literal dashboard screenshot, just a premium abstract
// object with real depth (physical glass material, specular highlights).
const CARD_COUNT = 5;
const CARD_TINTS = ['#0F6E5B', '#14805F', '#1C8E63', '#B8873A', '#0F6E5B'];

function LedgerCard({ index }: { index: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const angle = (index / CARD_COUNT) * Math.PI * 2;
  const radius = 0.55;
  const baseY = (index - (CARD_COUNT - 1) / 2) * 0.62;

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    // One card periodically "lifts" out of the stack — a slow breathing
    // motion, offset per-card so they don't all move in lockstep.
    const lift = Math.sin(t * 0.4 + index * 1.3) * 0.12;
    meshRef.current.position.y = baseY + lift;
    meshRef.current.rotation.z = Math.sin(t * 0.25 + index) * 0.04;
  });

  return (
    <mesh
      ref={meshRef}
      position={[Math.cos(angle) * radius, baseY, Math.sin(angle) * radius]}
      rotation={[0.15, angle, 0]}
    >
      <RoundedBox args={[1.5, 0.5, 0.06]} radius={0.05} smoothness={4}>
        <meshPhysicalMaterial
          color={CARD_TINTS[index % CARD_TINTS.length]}
          transmission={0.75}
          thickness={0.4}
          roughness={0.18}
          ior={1.4}
          reflectivity={0.6}
          clearcoat={0.6}
          clearcoatRoughness={0.25}
          transparent
          opacity={0.9}
        />
      </RoundedBox>
    </mesh>
  );
}

function LedgerScene() {
  const groupRef = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const { size } = useThree();

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    // Slow continuous auto-rotate (~5s/revolution would be too fast for an
    // ambient background element — this is a full revolution roughly every
    // 48 seconds) plus a small pointer-driven parallax tilt.
    groupRef.current.rotation.y += delta * 0.13;
    const targetTiltX = pointer.current.y * 0.15;
    const targetTiltZ = -pointer.current.x * 0.1;
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetTiltX, 0.03);
    groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, targetTiltZ, 0.03);
  });

  const cards = useMemo(() => Array.from({ length: CARD_COUNT }, (_, i) => i), []);

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 6, 4]} intensity={1.4} color="#FFF7E8" />
      <pointLight position={[-4, -2, -3]} intensity={0.6} color="#B8873A" />
      <pointLight position={[3, 3, 3]} intensity={0.5} color="#0F6E5B" />
      <group ref={groupRef} scale={size.width < 640 ? 0.75 : 1}>
        {cards.map((i) => (
          <LedgerCard key={i} index={i} />
        ))}
      </group>
    </>
  );
}

export default function LedgerStack() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
  }, []);

  if (reducedMotion) {
    return (
      <div className="absolute inset-0 -z-20 flex items-center justify-center opacity-40 pointer-events-none">
        <div className="w-72 h-72 rounded-[2rem] border border-[var(--color-premium-accent)]/25 bg-[var(--color-premium-accent-soft)]/40" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 w-full h-full -z-20 pointer-events-none overflow-hidden">
      <Canvas camera={{ position: [0, 0, 4.6], fov: 42 }} style={{ pointerEvents: 'none' }}>
        <LedgerScene />
      </Canvas>
    </div>
  );
}
