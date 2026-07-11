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
  { id: 'checkin', label: '1. Check-In', caption: 'Facial & IMEI checks start.', pos: [-4.0, 0.5, 0], color: '#6B7A80' },
  { id: 'verify', label: '2. Verification', caption: 'Liveness validation run.', pos: [-2.2, -0.5, 0], color: '#E8B95B' },
  { id: 'active', label: '3. Active Duty', caption: 'Geofence active guard.', pos: [-0.4, 0.6, 0], color: '#4FD1A5' },
  { id: 'break', label: '4. Coffee Break', caption: 'Presence gap reconciled.', pos: [1.4, -0.4, 0], color: '#3FA9C9' },
  { id: 'checkout', label: '5. Check-Out', caption: 'Coordinates signature seal.', pos: [3.2, 0.5, 0], color: '#2E7D5B' }
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
        <lineBasicMaterial color="#8FE3C0" linewidth={1.5} transparent opacity={0.3} />
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
                color={active ? wp.color : '#2A3C44'} 
                emissive={active ? wp.color : '#000000'} 
                emissiveIntensity={0.6}
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
                <span className="block font-display font-bold text-[11px] text-[#EAF6FB] uppercase tracking-tight">
                  {wp.label}
                </span>
                <span className="block text-[9px] text-[#9FB4BC] font-sans font-medium mt-0.5 leading-tight">
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
          color="#8FE3C0" 
          emissive="#0B2A2E" 
          roughness={0.1}
          metalness={0.9} 
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
      className="glass-panel-heavy rounded-[32px] border border-slate-200/50 p-6 md:p-8 shadow-xl max-w-4xl mx-auto backdrop-blur-md relative overflow-hidden"
    >
      <div className="flex justify-between items-center mb-6">
        <div>
          <span className="font-mono text-[9px] tracking-widest text-[#8FE3C0] font-black uppercase">
            IMMUTABLE WORKFLOW FLIGHT_PATH
          </span>
          <h4 className="font-display font-black text-lg text-slate-950 tracking-tight mt-0.5">
            Five Waypoints of Verified Presence
          </h4>
        </div>

        <button
          onClick={handleReplay}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 hover:bg-slate-850 text-white text-[10px] font-mono tracking-wider font-extrabold cursor-pointer transition-all shadow-md uppercase"
        >
          <RefreshCw className={`w-3 h-3 ${playing ? 'animate-spin' : ''}`} />
          Replay Flight
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

      {/* Bottom active waypoint summary readouts */}
      <div className="pt-4 border-t border-slate-200/40 flex justify-between items-center text-[11px] font-mono select-none text-slate-500">
        <span className="font-bold flex items-center gap-1">
          <Play className="w-3.5 h-3.5 text-[#8FE3C0]" />
          ACTIVE WAYPOINT STATE:
        </span>
        <span className="font-black px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-950 uppercase">
          {WAYPOINTS[activeStep]?.label || 'Awaiting launch...'}
        </span>
      </div>
    </div>
  );
}
