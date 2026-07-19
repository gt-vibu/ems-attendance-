/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { 
  ShieldAlert, RefreshCw, CheckCircle, Coffee, ShieldCheck, HelpCircle, XCircle, Moon, Play 
} from 'lucide-react';

interface StateNode {
  id: string;
  name: string;
  meaning: string;
  color: string;
  icon: any;
  outgoing: string[]; // List of IDs it can transition to
}

const STATE_NODES: StateNode[] = [
  { id: 'NOT_STARTED', name: 'Not Started', meaning: 'Shift not yet begun — verification gate is armed.', color: '#8A9089', icon: Play, outgoing: ['PENDING_VERIFICATION', 'ABSENT'] },
  { id: 'PENDING_VERIFICATION', name: 'Verifying', meaning: 'Face and location checks are running.', color: '#C97F27', icon: RefreshCw, outgoing: ['ACTIVE', 'NEEDS_REVIEW', 'REJECTED'] },
  { id: 'ACTIVE', name: 'Active', meaning: 'Fully verified — location and identity confirmed.', color: '#0F6E5B', icon: ShieldCheck, outgoing: ['ON_BREAK', 'CLOSED', 'NEEDS_REVIEW'] },
  { id: 'ON_BREAK', name: 'On Break', meaning: 'Shift paused — location tracking suspended.', color: '#2E6F8E', icon: Coffee, outgoing: ['ACTIVE', 'CLOSED'] },
  { id: 'NEEDS_REVIEW', name: 'Needs Review', meaning: 'Flagged for a location gap or verification issue.', color: '#B8873A', icon: ShieldAlert, outgoing: ['CLOSED', 'REJECTED', 'PENDING_APPROVAL'] },
  { id: 'PENDING_APPROVAL', name: 'Pending Approval', meaning: 'A correction has been filed and awaits sign-off.', color: '#7C6FB0', icon: HelpCircle, outgoing: ['CLOSED', 'REJECTED'] },
  { id: 'CLOSED', name: 'Closed', meaning: 'Checkout verified — the record is locked in.', color: '#14805F', icon: CheckCircle, outgoing: [] },
  { id: 'REJECTED', name: 'Rejected', meaning: 'Verification failed — the attempt was discarded.', color: '#B3432B', icon: XCircle, outgoing: ['NOT_STARTED'] },
  { id: 'ABSENT', name: 'Absent', meaning: 'Shift began but no check-in was ever completed.', color: '#8A9089', icon: Moon, outgoing: ['NOT_STARTED'] }
];

function OrbitRing() {
  const groupRef = useRef<THREE.Group>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const radius = isMobile ? 3.0 : 4.5;
  const speed = isMobile ? 0.35 : 0.12; // Angle addition speed

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    if (groupRef.current && !hoveredId) {
      // Linear orbit rotation
      groupRef.current.rotation.y = time * speed;
    }
  });

  // Calculate coordinates for arcs to target states
  const renderArcs = () => {
    if (!hoveredId) return null;
    const sourceNode = STATE_NODES.find(n => n.id === hoveredId);
    if (!sourceNode) return null;

    const sourceIdx = STATE_NODES.indexOf(sourceNode);
    const sourceAngle = (sourceIdx / STATE_NODES.length) * Math.PI * 2;
    const sX = Math.cos(sourceAngle) * radius;
    const sZ = Math.sin(sourceAngle) * radius;
    const sY = 0.2; // slight lift for arc start

    return sourceNode.outgoing.map((targetId) => {
      const targetNode = STATE_NODES.find(n => n.id === targetId);
      if (!targetNode) return null;

      const targetIdx = STATE_NODES.indexOf(targetNode);
      const targetAngle = (targetIdx / STATE_NODES.length) * Math.PI * 2;
      const tX = Math.cos(targetAngle) * radius;
      const tZ = Math.sin(targetAngle) * radius;
      const tY = 0;

      // Create quadratic bezier curve for arc height representation
      const mX = (sX + tX) / 2;
      const mZ = (sZ + tZ) / 2;
      const mY = 1.2; // height elevation

      const points: THREE.Vector3[] = [];
      const steps = 20;
      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        const x = (1 - t) ** 2 * sX + 2 * (1 - t) * t * mX + t ** 2 * tX;
        const y = (1 - t) ** 2 * sY + 2 * (1 - t) * t * mY + t ** 2 * tY;
        const z = (1 - t) ** 2 * sZ + 2 * (1 - t) * t * mZ + t ** 2 * tZ;
        points.push(new THREE.Vector3(x, y, z));
      }

      const geom = new THREE.BufferGeometry().setFromPoints(points);

      return (
        <line key={`${hoveredId}-${targetId}`}>
          <primitive object={geom} attach="geometry" />
          <lineBasicMaterial color={sourceNode.color} linewidth={2.5} transparent opacity={0.8} />
        </line>
      );
    });
  };

  return (
    <group>
      <group ref={groupRef}>
        {STATE_NODES.map((node, idx) => {
          const angle = (idx / STATE_NODES.length) * Math.PI * 2;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          const isHovered = hoveredId === node.id;
          const Icon = node.icon;

          return (
            <group 
              key={node.id} 
              position={[x, isHovered ? 0.3 : 0, z]}
            >
              {/* Force Billboard orientation towards camera by canceling group rotation */}
              <group rotation={[0, -angle - (groupRef.current?.rotation?.y || 0) + Math.PI / 2, 0]}>
                <Html transform distanceFactor={isMobile ? 4.5 : 5.5} pointerEvents="auto" center>
                  <div
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{ borderColor: node.color, boxShadow: isHovered ? `0 16px 32px -10px ${node.color}40` : '0 1px 2px rgba(20,35,30,0.05), 0 2px 8px rgba(20,35,30,0.05)' }}
                    className="w-[180px] bg-white/95 border-2 rounded-2xl p-4 text-[var(--color-premium-ink)] font-sans select-none pointer-events-auto cursor-pointer transition-all duration-300 transform hover:scale-105"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${node.color}18` }}>
                        <Icon className="w-4 h-4" style={{ color: node.color }} />
                      </div>
                      <span className="text-[11px] font-bold tracking-tight" style={{ color: node.color }}>
                        {node.name}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--color-premium-muted)] leading-normal font-medium">
                      {node.meaning}
                    </p>

                    {isHovered && (
                      <div className="mt-3 pt-2 border-t border-[var(--color-premium-border)] flex items-center justify-between">
                        <span className="text-[9px] text-[var(--color-premium-muted)] font-semibold uppercase tracking-wide">Leads to</span>
                        <span className="text-[9px] font-bold" style={{ color: node.color }}>
                          {node.outgoing.length > 0 ? `${node.outgoing.length} state${node.outgoing.length === 1 ? '' : 's'}` : 'End of flow'}
                        </span>
                      </div>
                    )}
                  </div>
                </Html>
              </group>
            </group>
          );
        })}
      </group>
      {renderArcs()}
    </group>
  );
}

export default function StateOrbit() {
  return (
    <div className="w-full h-[400px] bg-gradient-to-b from-transparent via-[var(--color-premium-accent-soft)]/40 to-transparent relative overflow-visible select-none">
      <div className="absolute inset-x-0 top-0 text-center z-10 pointer-events-none">
        <span className="text-[11px] tracking-wide text-[var(--color-premium-accent)] font-bold uppercase">
          How verification flows
        </span>
        <h4 className="font-display font-semibold text-2xl text-[var(--color-premium-ink)] tracking-tight mt-1">
          Every state, at a glance
        </h4>
        <p className="text-sm text-[var(--color-premium-muted)] font-sans max-w-sm mx-auto mt-1.5 leading-relaxed">
          Hover any state to see exactly where it can lead next.
        </p>
      </div>

      <Canvas camera={{ position: [0, 2.5, 7.5], fov: 45 }} className="w-full h-full">
        <ambientLight intensity={1.5} />
        <pointLight position={[10, 10, 10]} intensity={1} />
        <OrbitRing />
      </Canvas>
    </div>
  );
}
