"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { type FeedTx, type SlotSummary } from "@/lib/feed";
import { startFeed, type FeedState } from "@/lib/feedSource";

/* ------------------------------------------------------------------ */
/*  the stream: transactions spawn on an outer ring and fall toward    */
/*  the core; every ~400ms the slot closes and the core pulses.        */
/*                                                                     */
/*  one InstancedMesh, fixed pool, zero per-frame allocations — the    */
/*  oldest particle is recycled when the pool wraps.                   */
/* ------------------------------------------------------------------ */

const POOL = 4000;
// hard cap on spawns drained per frame so network bursts degrade
// gracefully instead of dropping frames
const MAX_SPAWNS_PER_FRAME = 120;

const KIND_COLOR: Record<FeedTx["kind"], THREE.Color> = {
  vote: new THREE.Color("#3b2a63"), // ambient dust — dim on purpose
  transfer: new THREE.Color("#22d3ee"),
  swap: new THREE.Color("#e879f9"),
  nft: new THREE.Color("#34d399"),
  other: new THREE.Color("#cbd5e1"),
};

const SPAWN_RADIUS = 9;
const CAPTURE_RADIUS = 0.7;

interface Shared {
  queue: FeedTx[];
  pulse: { value: number };
}

const Particles = ({ shared }: { shared: Shared }) => {
  const mesh = useRef<THREE.InstancedMesh>(null);

  // particle state lives in flat preallocated arrays
  const state = useRef({
    pos: new Float32Array(POOL * 3),
    vel: new Float32Array(POOL * 3),
    scale: new Float32Array(POOL),
    alive: new Uint8Array(POOL),
    cursor: 0,
    dummy: new THREE.Object3D(),
  });

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const s = state.current;
    const dt = Math.min(delta, 0.05);

    // drain queued transactions into the pool (capped per frame)
    const spawns = Math.min(shared.queue.length, MAX_SPAWNS_PER_FRAME);
    for (let n = 0; n < spawns; n++) {
      const tx = shared.queue[n];
      const i = s.cursor;
      s.cursor = (s.cursor + 1) % POOL;

      // spawn on a ring, with some depth scatter
      const a = Math.random() * Math.PI * 2;
      const r = SPAWN_RADIUS * (0.85 + Math.random() * 0.3);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.6;
      const z = (Math.random() - 0.5) * 4;
      s.pos[i * 3] = x;
      s.pos[i * 3 + 1] = y;
      s.pos[i * 3 + 2] = z;

      // aim at the core; heavier tx fall faster
      const speed = 2.2 + tx.weight * 0.5 + Math.random() * 0.8;
      const len = Math.hypot(x, y, z) || 1;
      s.vel[i * 3] = (-x / len) * speed;
      s.vel[i * 3 + 1] = (-y / len) * speed;
      s.vel[i * 3 + 2] = (-z / len) * speed;

      s.scale[i] = 0.03 + tx.weight * 0.035;
      s.alive[i] = 1;
      m.setColorAt(i, KIND_COLOR[tx.kind]);
    }
    if (spawns > 0) {
      shared.queue.splice(0, spawns);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // advance + recycle
    for (let i = 0; i < POOL; i++) {
      if (!s.alive[i]) {
        s.dummy.position.set(0, 0, 9999); // park dead instances off-screen
        s.dummy.scale.setScalar(0.0001);
      } else {
        s.pos[i * 3] += s.vel[i * 3] * dt;
        s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
        s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
        const d = Math.hypot(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]);
        if (d < CAPTURE_RADIUS) s.alive[i] = 0; // absorbed by the core
        s.dummy.position.set(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]);
        s.dummy.scale.setScalar(s.scale[i]);
      }
      s.dummy.updateMatrix();
      m.setMatrixAt(i, s.dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, POOL]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
};

/* core — the current slot; flashes when the slot closes */
const Core = ({ shared }: { shared: Shared }) => {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, delta) => {
    const p = shared.pulse;
    p.value *= Math.exp(-delta * 6); // pulse decays fast
    if (mesh.current) {
      const breathe = 1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.04;
      mesh.current.scale.setScalar(breathe + p.value * 0.5);
      mesh.current.rotation.y += delta * 0.2;
      mesh.current.rotation.z += delta * 0.07;
    }
    if (mat.current) {
      mat.current.color.setScalar(0); // keep it a silhouette…
      mat.current.color.lerp(CORE_FLASH, 0.25 + p.value); // …that flashes violet
    }
  });

  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[CAPTURE_RADIUS, 1]} />
      <meshBasicMaterial ref={mat} wireframe toneMapped={false} />
    </mesh>
  );
};

const CORE_FLASH = new THREE.Color("#a78bfa");

/* ------------------------------------------------------------------ */

const Scene = () => {
  const shared = useRef<Shared>({ queue: [], pulse: { value: 0 } });
  const [slot, setSlot] = useState<SlotSummary | null>(null);
  const [feed, setFeed] = useState<FeedState>({
    mode: "synthetic",
    label: "connecting…",
  });

  useEffect(() => {
    return startFeed({
      onTx: (tx) => {
        // drop excess dust under backpressure, never the interesting stuff
        if (shared.current.queue.length > 600 && tx.kind === "vote") return;
        shared.current.queue.push(tx);
      },
      onSlot: (s) => {
        shared.current.pulse.value = 1;
        setSlot(s);
      },
      onState: setFeed,
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-[#07050d]">
      <Canvas camera={{ position: [0, 0, 13], fov: 50 }} dpr={[1, 1.5]}>
        <Particles shared={shared.current} />
        <Core shared={shared.current} />
      </Canvas>

      {/* minimal HUD — numbers stay ambient, the scene is the interface */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-6 font-mono text-xs text-white/50">
        <div>
          <p className="text-white/80">heartbeat</p>
          <p className="mt-1">
            every light is a transaction ·{" "}
            <span className={feed.mode === "live" ? "text-emerald-300/70" : ""}>
              {feed.label}
            </span>
          </p>
        </div>
        {slot && (
          <div className="text-right">
            <p className="text-white/80">slot {slot.slot.toLocaleString()}</p>
            <p className="mt-1">{slot.txCount} tx / 400ms</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scene;
