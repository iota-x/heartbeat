"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

import { type FeedTx, type SlotSummary } from "@/lib/feed";
import { startFeed, type FeedState } from "@/lib/feedSource";
import { createShared, type SceneShared } from "@/lib/sceneState";
import { HeartbeatAudio } from "@/lib/audio";
import { TIERS, WARMUP_S, WINDOW_S, MIN_FPS } from "@/lib/quality";
import Whales from "@/components/Whales";
import Blocks from "@/components/Blocks";
import Starfield from "@/components/Starfield";
import Shockwave from "@/components/Shockwave";
import Validators from "@/components/Validators";
import Hud from "@/components/Hud";
import Overlay from "@/components/Overlay";
import Poster from "@/components/Poster";

/* ------------------------------------------------------------------ */
/*  the stream: transactions spawn on an outer ring and spiral toward  */
/*  the core; every ~400ms the slot closes — the accumulated energy    */
/*  collapses inward, the core flashes, and a block is ejected into    */
/*  the receding chain.                                                */
/*                                                                     */
/*  one InstancedMesh per element class, fixed pools, zero per-frame   */
/*  allocations — the oldest particle is recycled when a pool wraps.   */
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

const Particles = ({ shared }: { shared: SceneShared }) => {
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

    // adaptive budget: fewer instances drawn and recycled sooner when the
    // quality governor has stepped down
    const budget = Math.min(POOL, shared.quality.particleBudget);
    m.count = budget;
    if (s.cursor >= budget) s.cursor = 0;

    // drain queued transactions into the pool (capped per frame)
    const spawns = Math.min(shared.queue.length, MAX_SPAWNS_PER_FRAME);
    for (let n = 0; n < spawns; n++) {
      const tx = shared.queue[n];
      const i = s.cursor;
      s.cursor = (s.cursor + 1) % budget;

      // spawn on a ring, with some depth scatter
      const a = Math.random() * Math.PI * 2;
      const r = SPAWN_RADIUS * (0.85 + Math.random() * 0.3);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.6;
      const z = (Math.random() - 0.5) * 4;
      s.pos[i * 3] = x;
      s.pos[i * 3 + 1] = y;
      s.pos[i * 3 + 2] = z;

      // aim at the core with a tangential component so streams spiral in;
      // heavier tx fall faster
      const speed = 2.2 + tx.weight * 0.5 + Math.random() * 0.8;
      const len = Math.hypot(x, y, z) || 1;
      const swirl = 0.35;
      s.vel[i * 3] = (-x / len) * speed + (-y / len) * speed * swirl;
      s.vel[i * 3 + 1] = (-y / len) * speed + (x / len) * speed * swirl;
      s.vel[i * 3 + 2] = (-z / len) * speed;

      s.scale[i] = 0.03 + tx.weight * 0.035;
      s.alive[i] = 1;
      m.setColorAt(i, KIND_COLOR[tx.kind]);
    }
    if (spawns > 0) {
      shared.queue.splice(0, spawns);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    // advance + recycle; slot close sucks everything toward the core
    const collapsePull = shared.collapse.value * 9 * dt;
    for (let i = 0; i < budget; i++) {
      if (!s.alive[i]) {
        s.dummy.position.set(0, 0, 9999); // park dead instances off-screen
        s.dummy.scale.setScalar(0.0001);
      } else {
        const d =
          Math.hypot(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]) || 1;
        const pull = (1.2 * dt + collapsePull) / d;
        s.vel[i * 3] += -s.pos[i * 3] * pull;
        s.vel[i * 3 + 1] += -s.pos[i * 3 + 1] * pull;
        s.vel[i * 3 + 2] += -s.pos[i * 3 + 2] * pull;
        s.pos[i * 3] += s.vel[i * 3] * dt;
        s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
        s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
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
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, POOL]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 6, 6]} />
      {/* additive: overlapping lights sum past 1.0 and start to bloom, so
       * the field gets hotter the denser the traffic */}
      <meshBasicMaterial
        toneMapped={false}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
};

/* core — the current slot; flashes HDR-hot when the slot closes so the
 * bloom pass catches it */
const CORE_FLASH = new THREE.Color("#a78bfa");

const Core = ({ shared }: { shared: SceneShared }) => {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state, delta) => {
    const p = shared.pulse;
    p.value *= Math.exp(-delta * 6); // pulse decays fast
    shared.collapse.value *= Math.exp(-delta * 8); // collapse is a snap
    if (mesh.current) {
      const breathe = 1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.04;
      mesh.current.scale.setScalar(breathe + p.value * 0.5);
      mesh.current.rotation.y += delta * 0.2;
      mesh.current.rotation.z += delta * 0.07;
    }
    if (mat.current) {
      // silhouette that flashes violet past 1.0 → blooms
      mat.current.color.copy(CORE_FLASH).multiplyScalar(0.3 + p.value * 2.2);
    }
    if (glowMat.current) {
      glowMat.current.color.copy(CORE_FLASH).multiplyScalar(p.value * 4);
    }
  });

  return (
    <group>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[CAPTURE_RADIUS, 1]} />
        <meshBasicMaterial ref={mat} wireframe toneMapped={false} />
      </mesh>
      {/* inner ember — only visible (and HDR) during the flash */}
      <mesh>
        <sphereGeometry args={[CAPTURE_RADIUS * 0.55, 16, 16]} />
        <meshBasicMaterial
          ref={glowMat}
          toneMapped={false}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};

/* measures real fps after a warmup and steps quality down when it can't
 * hold the line; never steps back up, so it can't oscillate */
const QualityGovernor = ({ onDegrade }: { onDegrade: () => void }) => {
  const s = useRef({ frames: 0, windowStart: 0, warmedUp: false });

  useFrame(({ clock }, delta) => {
    const st = s.current;
    const t = clock.elapsedTime;
    if (!st.warmedUp) {
      if (t < WARMUP_S) return;
      st.warmedUp = true;
      st.windowStart = t;
      st.frames = 0;
      return;
    }
    // a huge single-frame gap means a tab switch, not slow rendering
    if (delta > 0.3) {
      st.windowStart = t;
      st.frames = 0;
      return;
    }
    st.frames++;
    if (t - st.windowStart >= WINDOW_S) {
      const fps = st.frames / (t - st.windowStart);
      if (fps < MIN_FPS) onDegrade();
      st.windowStart = t;
      st.frames = 0;
    }
  });
  return null;
};

/* slow cinematic drift + impact shake, always looking at the core */
const CameraRig = ({ shared }: { shared: SceneShared }) => {
  useFrame((state, delta) => {
    shared.shake.value *= Math.exp(-delta * 2.5);
    const t = state.clock.elapsedTime;
    const k = shared.shake.value;
    const cam = state.camera;
    cam.position.x = Math.sin(t * 0.05) * 0.9 + Math.sin(t * 43.7) * 0.14 * k;
    cam.position.y = Math.sin(t * 0.041 + 2) * 0.5 + Math.sin(t * 38.1 + 1.7) * 0.11 * k;
    cam.position.z = 13 + Math.sin(t * 0.033 + 4) * 0.4 + Math.sin(t * 51.3) * 0.08 * k;
    cam.lookAt(0, 0, 0);
  });
  return null;
};

/* ------------------------------------------------------------------ */

const Scene = () => {
  const shared = useRef<SceneShared>(null!);
  if (shared.current === null) shared.current = createShared();
  const audio = useRef<HeartbeatAudio>(null!);
  if (audio.current === null) audio.current = new HeartbeatAudio();

  const [slot, setSlot] = useState<SlotSummary | null>(null);
  const [feed, setFeed] = useState<FeedState>({
    mode: "synthetic",
    label: "connecting…",
  });
  const [tps, setTps] = useState(0);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.5);
  const [toast, setToast] = useState<{ amountSol: number; id: number } | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [tier, setTier] = useState(0);
  const [webgl, setWebgl] = useState<"unknown" | "ok" | "none">("unknown");
  const [hidden, setHidden] = useState(false);
  const tpsRef = useRef(0);
  const lastToastAt = useRef(0);

  // WebGL-less browsers get a static poster with live numbers instead of a
  // black screen
  useEffect(() => {
    const probe = document.createElement("canvas");
    const ok = Boolean(
      probe.getContext("webgl2") ?? probe.getContext("webgl"),
    );
    const id = requestAnimationFrame(() => setWebgl(ok ? "ok" : "none"));
    return () => cancelAnimationFrame(id);
  }, []);

  // pause rendering entirely when the tab is hidden; the websocket stays up
  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // apply the tier's particle budget to the render loops
  useEffect(() => {
    shared.current.quality.particleBudget = TIERS[tier].particleBudget;
  }, [tier]);

  // whale impacts: shake the camera, thump, toast (throttled)
  useEffect(() => {
    const sh = shared.current;
    sh.fx.onWhaleImpact = (intensity, amountSol) => {
      sh.shake.value = Math.min(1, sh.shake.value + 0.35 + 0.5 * intensity);
      sh.pulse.value = Math.min(1.2, sh.pulse.value + 0.35);
      audio.current.thump(intensity, amountSol);
      const now = Date.now();
      if (amountSol > 0 && now - lastToastAt.current > 1_500) {
        lastToastAt.current = now;
        setToast({ amountSol, id: now });
      }
    };
  }, []);

  // restore saved volume (localStorage is client-only) — deferred a frame to
  // keep hydration clean, same as the overlay below
  useEffect(() => {
    const v = Number(localStorage.getItem("hb-vol"));
    if (!(v > 0 && v <= 1)) return;
    audio.current.setVolume(v);
    const id = requestAnimationFrame(() => setVolume(v));
    return () => cancelAnimationFrame(id);
  }, []);

  // overlay decision must wait for the client (localStorage) — deferred a
  // frame to keep hydration clean
  useEffect(() => {
    if (localStorage.getItem("hb-seen")) return;
    const id = requestAnimationFrame(() => setShowOverlay(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    return startFeed({
      onTx: (tx) => {
        const sh = shared.current;
        if (tx.whale) {
          if (sh.whaleQueue.length < 48) sh.whaleQueue.push(tx);
          return;
        }
        // drop excess dust under backpressure, never the interesting stuff
        if (sh.queue.length > 600 && tx.kind === "vote") return;
        sh.queue.push(tx);
      },
      onSlot: (s) => {
        const sh = shared.current;
        sh.pulse.value = 1;
        sh.collapse.value = 1;
        sh.eject.count++;
        sh.eject.slot = s.slot;
        audio.current.beat();
        const inst = s.txCount / 0.4;
        tpsRef.current =
          tpsRef.current === 0 ? inst : tpsRef.current * 0.75 + inst * 0.25;
        // soft-knee normalization: ~0.5 at 1.5k tps, ~0.7 at 3.5k
        audio.current.setActivity(tpsRef.current / (tpsRef.current + 1_500));
        setTps(tpsRef.current);
        setSlot(s);
      },
      onState: setFeed,
    });
  }, []);

  const toggleSound = () => {
    setMuted((m) => {
      if (m) audio.current.enable();
      else audio.current.disable();
      return !m;
    });
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    audio.current.setVolume(v);
    localStorage.setItem("hb-vol", String(v));
  };

  const dismissOverlay = () => {
    localStorage.setItem("hb-seen", "1");
    setShowOverlay(false);
  };

  const q = TIERS[tier];

  return (
    <div className="fixed inset-0 bg-[#07050d]">
      {webgl === "ok" && (
        <Canvas
          camera={{ position: [0, 0, 13], fov: 50 }}
          dpr={[1, q.dpr]}
          frameloop={hidden ? "never" : "always"}
          gl={{ antialias: false, powerPreference: "high-performance" }}
        >
          <Starfield />
          <Validators shared={shared.current} />
          <Particles shared={shared.current} />
          <Whales shared={shared.current} />
          <Blocks shared={shared.current} />
          <Core shared={shared.current} />
          <Shockwave shared={shared.current} />
          <CameraRig shared={shared.current} />
          <QualityGovernor
            onDegrade={() => setTier((t) => Math.min(t + 1, TIERS.length - 1))}
          />
          {q.bloom && (
            <EffectComposer multisampling={0}>
              <Bloom
                mipmapBlur
                intensity={0.85}
                luminanceThreshold={1}
                luminanceSmoothing={0.1}
              />
            </EffectComposer>
          )}
        </Canvas>
      )}
      {webgl === "none" && <Poster feed={feed} slot={slot} tps={tps} />}

      <Hud
        feed={feed}
        slot={slot}
        tps={tps}
        muted={muted}
        onToggleSound={toggleSound}
        volume={volume}
        onVolume={changeVolume}
        toast={toast}
      />
      {showOverlay && <Overlay onDismiss={dismissOverlay} />}
    </div>
  );
};

export default Scene;
