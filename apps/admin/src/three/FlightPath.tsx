/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { RefreshCw, Play } from 'lucide-react';

interface Waypoint {
  id: string;
  label: string;
  caption: string;
  pos: [number, number, number];
  color: string;
}

const WAYPOINTS: Waypoint[] = [
  { id: 'checkin', label: '1. Check-In', caption: 'Face and device checks begin.', pos: [-4.0, 0.5, 0], color: '#8A9089' },
  { id: 'verify', label: '2. Verification', caption: 'Liveness is confirmed.', pos: [-2.2, -0.5, 0], color: '#B8873A' },
  { id: 'active', label: '3. Active Duty', caption: 'Location is actively tracked.', pos: [-0.4, 0.6, 0], color: '#0F6E5B' },
  { id: 'break', label: '4. Break', caption: 'Time away is reconciled.', pos: [1.4, -0.4, 0], color: '#2E6F8E' },
  { id: 'checkout', label: '5. Check-Out', caption: 'The record is sealed.', pos: [3.2, 0.5, 0], color: '#14805F' }
];

function ScenePath({ progress, onReached }: { progress: number; onReached: (idx: number) => void }) {
  const badgeRef = useRef<THREE.Mesh>(null);
  const reachedIndices = useRef<Set<number>>(new Set());

  // Define bezier path points
  const p0 = new THREE.Vector3(-4.0, 0.5, 0);
  const p1 = new THREE.Vector3(-2.2, -0.5, 0);
  const p2 = new THREE.Vector3(-0.4, 0.6, 0);
  const p3 = new THREE.Vector3(1.4, -0.4, 0);
  const p4 = new THREE.Vector3(3.2, 0.5, 0);

  // Compute curve points for representation line
  const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4]);
  const curveGeom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));

  useFrame(() => {
    if (badgeRef.current) {
      // Find coordinates on curve depending on progress (0 -> 1)
      const clampedProgress = Math.max(0, Math.min(1, progress));
      const currentPoint = curve.getPointAt(clampedProgress);
      if (currentPoint) {
        badgeRef.current.position.copy(currentPoint);

        // Micro spin
        badgeRef.current.rotation.y += 0.03;
        badgeRef.current.rotation.x += 0.01;

        // Identify active node passed
        WAYPOINTS.forEach((wp, idx) => {
          const wpPos = new THREE.Vector3(...wp.pos);
          if (currentPoint.distanceTo(wpPos) < 0.65) {
            if (!reachedIndices.current.has(idx)) {
              reachedIndices.current.add(idx);
              onReached(idx);
            }
          }
        });
      }
    }
  });

  return (
    <group>
      {/* Visual dotted path */}
      <line>
        <primitive object={curveGeom} attach="geometry" />
        <lineBasicMaterial color="#0F6E5B" linewidth={1.5} transparent opacity={0.3} />
      </line>

      {/* Waypoint nodes */}
      {WAYPOINTS.map((wp, idx) => {
        const active = progress >= idx / (WAYPOINTS.length - 1) - 0.05;
        return (
          <group key={wp.id} position={wp.pos}>
            {/* Mesh Node */}
            <mesh>
              <sphereGeometry args={[0.15, 16, 16]} />
              <meshStandardMaterial
                color={active ? wp.color : '#D8D4C8'}
                emissive={active ? wp.color : '#000000'}
                emissiveIntensity={0.5}
              />
            </mesh>

            {/* Glowing ring */}
            {active && (
              <mesh>
                <ringGeometry args={[0.22, 0.26, 16]} />
                <meshBasicMaterial color={wp.color} side={THREE.DoubleSide} transparent opacity={0.5} />
              </mesh>
            )}

            {/* HTML Annotation label beneath */}
            <Html distanceFactor={6} center style={{ pointerEvents: 'none' }}>
              <div className="w-28 text-center mt-6 select-none">
                <span className="block font-display font-semibold text-[12px] text-[var(--color-premium-ink)] tracking-tight">
                  {wp.label}
                </span>
                <span className="block text-[10px] text-[var(--color-premium-muted)] font-sans font-medium mt-0.5 leading-tight">
                  {wp.caption}
                </span>
              </div>
            </Html>
          </group>
        );
      })}

      {/* Flying Badge Indicator Node */}
      <mesh ref={badgeRef}>
        <octahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial
          color="#0F6E5B"
          emissive="#0B4136"
          roughness={0.15}
          metalness={0.85}
        />
      </mesh>
    </group>
  );
}

export default function FlightPath() {
  const [progress, setProgress] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let animFrame: number;
    if (playing) {
      const update = () => {
        setProgress((prev) => {
          if (prev >= 1) {
            setPlaying(false);
            return 1;
          }
          return prev + 0.0035; // speed of flight path
        });
        animFrame = requestAnimationFrame(update);
      };
      animFrame = requestAnimationFrame(update);
    }
    return () => cancelAnimationFrame(animFrame);
  }, [playing]);

  // Handle intersection scroll play once
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPlaying(true);
          setProgress(0);
        }
      },
      { threshold: 0.1 }
    );
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, []);

  const handleReplay = () => {
    setProgress(0);
    setActiveStep(0);
    setPlaying(true);
  };

  return (
    <div
      ref={containerRef}
      className="glass-card rounded-[32px] p-6 md:p-8 max-w-4xl mx-auto relative overflow-hidden"
      style={{ boxShadow: 'var(--shadow-elevation-2)' }}
    >
      <div className="flex justify-between items-center mb-6">
        <div>
          <span className="text-[11px] tracking-wide text-[var(--color-premium-accent)] font-bold uppercase">
            How it works
          </span>
          <h4 className="font-display font-semibold text-xl text-[var(--color-premium-ink)] tracking-tight mt-0.5">
            From check-in to check-out
          </h4>
        </div>

        <button
          onClick={handleReplay}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[var(--color-premium-accent)] hover:bg-[var(--color-premium-accent-hover)] text-white text-[11px] font-bold tracking-wide cursor-pointer transition-colors shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${playing ? 'animate-spin' : ''}`} />
          Replay
        </button>
      </div>

      {/* R3F Interactive Line Canvas */}
      <div className="h-[220px] w-full relative overflow-visible">
        <Canvas camera={{ position: [0, 0, 5], fov: 45 }} style={{ pointerEvents: 'none' }}>
          <ambientLight intensity={1.5} />
          <pointLight position={[5, 5, 5]} intensity={1} />
          <ScenePath
            progress={progress}
            onReached={(idx) => setActiveStep(idx)}
          />
        </Canvas>
      </div>

      {/* Bottom active waypoint summary readout */}
      <div className="pt-4 border-t border-[var(--color-premium-border)] flex justify-between items-center text-[12px] select-none text-[var(--color-premium-muted)]">
        <span className="font-semibold flex items-center gap-1.5">
          <Play className="w-3.5 h-3.5 text-[var(--color-premium-accent)]" />
          Current step
        </span>
        <span className="font-bold px-3 py-1 rounded-full bg-[var(--color-premium-accent-soft)] text-[var(--color-premium-accent)]">
          {WAYPOINTS[activeStep]?.label || 'Ready to begin'}
        </span>
      </div>
    </div>
  );
}
