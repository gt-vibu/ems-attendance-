/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useLiveTheme } from '../hooks/useLiveTheme';
import { SessionStatus } from '../types';

interface PerimeterFieldProps {
  sessionState: SessionStatus;
  outsideToggle: boolean;
}

function FieldScene({ sessionState, outsideToggle }: PerimeterFieldProps) {
  const theme = useLiveTheme();
  const { camera } = useThree();
  const domeRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  
  // Scroll tracking for camera dolly and opacity fade
  const [scrollY, setScrollY] = useState(0);
  
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Token list for drifting
  const tokens = useRef([
    { id: 'token-1', basePos: new THREE.Vector3(-1.8, 0.4, 0.5), phase: 0, speed: 0.8, color: '#4FD1A5', outside: false, currentPos: new THREE.Vector3() },
    { id: 'token-2', basePos: new THREE.Vector3(1.6, -0.6, -0.4), phase: 1.5, speed: 1.1, color: '#3FA9C9', outside: false, currentPos: new THREE.Vector3() },
    { id: 'token-3', basePos: new THREE.Vector3(0.5, 1.5, -1.0), phase: 3.1, speed: 0.6, color: '#E8843F', outside: false, currentPos: new THREE.Vector3() },
    { id: 'token-4', basePos: new THREE.Vector3(-1.0, -1.2, -0.8), phase: 4.8, speed: 1.4, color: '#9C8CE8', outside: false, currentPos: new THREE.Vector3() }
  ]);

  // Trail renderers
  const [trails, setTrails] = useState<{ id: string; points: THREE.Vector3[] }[]>([]);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();

    // 1. Rotate translucent geofence dome slowly
    if (domeRef.current) {
      domeRef.current.rotation.y = time * 0.12;
      domeRef.current.rotation.x = time * 0.05;
      
      // Dynamic opacity based on scroll
      const fadeProgress = Math.max(0, 1 - scrollY / 600);
      const mat = domeRef.current.material as THREE.MeshStandardMaterial;
      if (mat) {
        mat.opacity = 0.15 * fadeProgress;
      }
    }

    if (coreRef.current) {
      coreRef.current.rotation.z = -time * 0.2;
    }

    // 2. Camera Dolly based on Scroll
    const targetZ = 6 + Math.min(4, scrollY * 0.008);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.1);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, scrollY * 0.002, 0.1);

    // 3. Move token positions
    tokens.current.forEach((t, i) => {
      // Bobbing sine wave
      const bob = Math.sin(time * t.speed + t.phase) * 0.18;
      const driftX = Math.cos(time * 0.5 + t.phase) * 0.12;

      // Check if user has toggled "Outside Geofence" manually for demo (we pull Token-1 out)
      let targetPos = t.basePos.clone();
      if (t.id === 'token-1' && outsideToggle) {
        targetPos.set(-3.2, 1.2, 1.2); // Drift far out
        t.outside = true;
      } else {
        t.outside = false;
      }

      // Smooth lerp to current pos
      t.currentPos.x = THREE.MathUtils.lerp(t.currentPos.x, targetPos.x + driftX, 0.04);
      t.currentPos.y = THREE.MathUtils.lerp(t.currentPos.y, targetPos.y + bob, 0.04);
      t.currentPos.z = THREE.MathUtils.lerp(t.currentPos.z, targetPos.z, 0.04);
    });
  });

  return (
    <>
      {/* Dynamic Ambient Lighting */}
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 10, 5]} intensity={1.8} castShadow />
      <pointLight position={[-10, -10, -10]} intensity={0.8} color="#8FE3C0" />

      {/* CORE HQ NODE */}
      <mesh ref={coreRef} position={[0, 0, 0]}>
        <octahedronGeometry args={[0.3, 0]} />
        <meshStandardMaterial 
          color="#8FE3C0" 
          emissive="#0D212C"
          roughness={0.1}
          metalness={0.9} 
        />
      </mesh>

      {/* GEODOME (Geofence Perimeter) */}
      <mesh ref={domeRef}>
        <icosahedronGeometry args={[2.5, 2]} />
        <meshStandardMaterial 
          color={theme.accentHex} 
          wireframe
          transparent 
          opacity={0.2} 
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Soft glass interior sphere representing the secure geofence zone */}
      <mesh>
        <sphereGeometry args={[2.45, 32, 32]} />
        <meshStandardMaterial
          color="#0B2A2E"
          transparent
          opacity={0.06}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>

      {/* TOKENS / AVATARS */}
      {tokens.current.map((t) => (
        <TokenNode key={t.id} token={t} themeAccent={theme.accentHex} />
      ))}

      {/* Particles "presence pings" arcing around core */}
      <PresenceParticles />
    </>
  );
}

// Token Node component representing individual employees
const TokenNode: React.FC<{ token: any; themeAccent: string }> = ({ token, themeAccent }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (meshRef.current && token && token.currentPos) {
      meshRef.current.position.copy(token.currentPos);
      // Continuous micro rotation
      meshRef.current.rotation.y += 0.01;
      meshRef.current.rotation.x += 0.005;
    }
  });

  return (
    <group>
      <mesh ref={meshRef}>
        <capsuleGeometry args={[0.15, 0.3, 8, 16]} />
        <meshStandardMaterial 
          color={token?.outside ? '#E05959' : token?.color} 
          roughness={0.2}
          metalness={0.7}
          emissive={token?.outside ? '#3a1111' : '#051821'}
        />
      </mesh>

      {/* Dashed trail if outside */}
      {token?.outside && token?.currentPos && (
        <line>
          <bufferGeometry>
            <float32BufferAttribute
              attach="attributes-position"
              args={[
                new Float32Array([
                  -1.8, 0.4, 0.5,
                  token.currentPos.x, token.currentPos.y, token.currentPos.z
                ]),
                3
              ]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#E05959" />
        </line>
      )}
    </group>
  );
};

// Sparkle particles representing network pings
function PresenceParticles() {
  const count = 40;
  const positions = useRef(new Float32Array(count * 3));
  const speeds = useRef(new Float32Array(count));
  const pointsRef = useRef<THREE.Points>(null);

  useEffect(() => {
    for (let i = 0; i < count; i++) {
      positions.current[i * 3] = (Math.random() - 0.5) * 6;
      positions.current[i * 3 + 1] = (Math.random() - 0.5) * 6;
      positions.current[i * 3 + 2] = (Math.random() - 0.5) * 6;
      speeds.current[i] = 0.01 + Math.random() * 0.02;
    }
  }, []);

  useFrame(() => {
    if (!pointsRef.current) return;
    const array = pointsRef.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      // drift back towards center origin
      array[i * 3] -= array[i * 3] * speeds.current[i];
      array[i * 3 + 1] -= array[i * 3 + 1] * speeds.current[i];
      array[i * 3 + 2] -= array[i * 3 + 2] * speeds.current[i];

      // Reset when they get too close
      const dist = Math.sqrt(
        array[i * 3] ** 2 +
        array[i * 3 + 1] ** 2 +
        array[i * 3 + 2] ** 2
      );
      if (dist < 0.2) {
        array[i * 3] = (Math.random() - 0.5) * 6;
        array[i * 3 + 1] = (Math.random() - 0.5) * 6;
        array[i * 3 + 2] = (Math.random() - 0.5) * 6;
      }
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions.current, 3]}
        />
      </bufferGeometry>
      <pointsMaterial 
        color="#8FE3C0" 
        size={0.06} 
        transparent 
        opacity={0.6} 
        sizeAttenuation 
      />
    </points>
  );
}

export default function PerimeterField({ sessionState, outsideToggle }: PerimeterFieldProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);
  }, []);

  if (reducedMotion) {
    return (
      <div className="absolute inset-0 bg-[#081418] -z-20 flex items-center justify-center opacity-60">
        <div className="w-96 h-96 rounded-full border border-dashed border-[#8FE3C0]/30 animate-spin-slow" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 w-full h-[720px] -z-20 pointer-events-none overflow-hidden opacity-80">
      <Canvas
        camera={{ position: [0, 0, 6], fov: 45 }}
        style={{ pointerEvents: 'none' }}
      >
        <FieldScene sessionState={sessionState} outsideToggle={outsideToggle} />
      </Canvas>
    </div>
  );
}
