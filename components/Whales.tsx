"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { SceneShared } from "@/lib/sceneState";

/* whale transfers get their own instanced pool: a hot HDR head that blooms,
 * a fading trail of ghost spheres behind it, and an impact callback that
 * drives camera shake + the audio thump. one draw call for all of it.
 *
 * layout: whale w owns instances [w*(TRAIL+1) .. w*(TRAIL+1)+TRAIL],
 * instance 0 is the head, the rest are trail ghosts. */

const WHALES = 24;
const TRAIL = 10;
const COUNT = WHALES * (TRAIL + 1);
const SPAWN_RADIUS = 11;
const CAPTURE_RADIUS = 1.0;
const HIST_STEP_S = 0.035; // seconds between trail samples

const GOLD = new THREE.Color("#ffb347");
const tmpColor = new THREE.Color();

const Whales = ({ shared }: { shared: SceneShared }) => {
  const mesh = useRef<THREE.InstancedMesh>(null);

  const state = useRef({
    pos: new Float32Array(WHALES * 3),
    vel: new Float32Array(WHALES * 3),
    scale: new Float32Array(WHALES),
    amount: new Float32Array(WHALES),
    age: new Float32Array(WHALES),
    active: new Uint8Array(WHALES),
    hist: new Float32Array(WHALES * TRAIL * 3),
    histCursor: new Uint8Array(WHALES),
    histTimer: new Float32Array(WHALES),
    dummy: new THREE.Object3D(),
  });

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const s = state.current;
    const dt = Math.min(delta, 0.05);
    let colorsDirty = false;

    // spawn (whales are rare; 2/frame is plenty even in a burst)
    for (let n = 0; n < 2 && shared.whaleQueue.length > 0; n++) {
      let w = -1;
      for (let i = 0; i < WHALES; i++) {
        if (!s.active[i]) {
          w = i;
          break;
        }
      }
      if (w < 0) break; // pool saturated — leave them queued
      const tx = shared.whaleQueue.shift()!;

      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * SPAWN_RADIUS;
      const y = Math.sin(a) * SPAWN_RADIUS * 0.6;
      const z = (Math.random() - 0.5) * 3;
      s.pos[w * 3] = x;
      s.pos[w * 3 + 1] = y;
      s.pos[w * 3 + 2] = z;

      // slow radial approach + tangential component → menacing spiral
      const len = Math.hypot(x, y, z) || 1;
      const speed = 1.7;
      s.vel[w * 3] = (-x / len) * speed + (-y / len) * speed * 0.55;
      s.vel[w * 3 + 1] = (-y / len) * speed + (x / len) * speed * 0.55;
      s.vel[w * 3 + 2] = (-z / len) * speed;

      s.scale[w] = 0.2 + Math.min(0.25, tx.weight * 0.035);
      s.amount[w] = tx.amountSol ?? 0;
      s.age[w] = 0;
      s.active[w] = 1;
      s.histCursor[w] = 0;
      s.histTimer[w] = 0;
      // trail starts collapsed onto the spawn point
      for (let g = 0; g < TRAIL; g++) {
        s.hist[(w * TRAIL + g) * 3] = x;
        s.hist[(w * TRAIL + g) * 3 + 1] = y;
        s.hist[(w * TRAIL + g) * 3 + 2] = z;
      }

      // head is HDR-hot (blooms), ghosts dim toward the tail — set once
      const base = w * (TRAIL + 1);
      m.setColorAt(base, tmpColor.copy(GOLD).multiplyScalar(3.2));
      for (let g = 0; g < TRAIL; g++) {
        const f = 1 - (g + 1) / (TRAIL + 1);
        m.setColorAt(base + 1 + g, tmpColor.copy(GOLD).multiplyScalar(1.6 * f * f));
      }
      colorsDirty = true;
    }

    // integrate + write matrices
    for (let w = 0; w < WHALES; w++) {
      const base = w * (TRAIL + 1);
      if (!s.active[w]) {
        for (let k = 0; k <= TRAIL; k++) {
          s.dummy.position.set(0, 0, 9999);
          s.dummy.scale.setScalar(0.0001);
          s.dummy.updateMatrix();
          m.setMatrixAt(base + k, s.dummy.matrix);
        }
        continue;
      }

      const px = s.pos[w * 3];
      const py = s.pos[w * 3 + 1];
      const pz = s.pos[w * 3 + 2];
      const d = Math.hypot(px, py, pz) || 1;
      s.age[w] += dt;

      // gravity well that tightens with age, plus drag that bleeds off the
      // tangential velocity — without it whales conserve angular momentum
      // and orbit forever instead of impacting
      const pull = 2.6 * (1 + Math.max(0, s.age[w] - 5) * 1.4) * dt;
      const drag = Math.exp(-0.22 * dt);
      s.vel[w * 3] = s.vel[w * 3] * drag + (-px / d) * pull;
      s.vel[w * 3 + 1] = s.vel[w * 3 + 1] * drag + (-py / d) * pull;
      s.vel[w * 3 + 2] = s.vel[w * 3 + 2] * drag + (-pz / d) * pull;

      s.pos[w * 3] += s.vel[w * 3] * dt;
      s.pos[w * 3 + 1] += s.vel[w * 3 + 1] * dt;
      s.pos[w * 3 + 2] += s.vel[w * 3 + 2] * dt;

      if (d < CAPTURE_RADIUS) {
        s.active[w] = 0;
        shared.fx.onWhaleImpact(Math.min(1, s.scale[w] / 0.45), s.amount[w]);
        continue;
      }

      // sample the trail on a fixed clock so its length is speed-independent
      s.histTimer[w] += dt;
      if (s.histTimer[w] >= HIST_STEP_S) {
        s.histTimer[w] = 0;
        const c = s.histCursor[w];
        s.hist[(w * TRAIL + c) * 3] = px;
        s.hist[(w * TRAIL + c) * 3 + 1] = py;
        s.hist[(w * TRAIL + c) * 3 + 2] = pz;
        s.histCursor[w] = (c + 1) % TRAIL;
      }

      s.dummy.position.set(s.pos[w * 3], s.pos[w * 3 + 1], s.pos[w * 3 + 2]);
      const throb = 1 + Math.sin((px + py) * 0.5 + performance.now() * 0.012) * 0.12;
      s.dummy.scale.setScalar(s.scale[w] * throb);
      s.dummy.updateMatrix();
      m.setMatrixAt(base, s.dummy.matrix);

      for (let g = 0; g < TRAIL; g++) {
        const idx = (s.histCursor[w] - 1 - g + TRAIL * 2) % TRAIL;
        s.dummy.position.set(
          s.hist[(w * TRAIL + idx) * 3],
          s.hist[(w * TRAIL + idx) * 3 + 1],
          s.hist[(w * TRAIL + idx) * 3 + 2],
        );
        s.dummy.scale.setScalar(s.scale[w] * (1 - (g + 1) / (TRAIL + 1)) * 0.75);
        s.dummy.updateMatrix();
        m.setMatrixAt(base + 1 + g, s.dummy.matrix);
      }
    }

    m.instanceMatrix.needsUpdate = true;
    if (colorsDirty && m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
};

export default Whales;
