"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { SceneShared } from "@/lib/sceneState";

/* the chain: every slot close the core ejects a compact block that drifts
 * back into a receding line of recent blocks. last CHAIN blocks kept, older
 * ones fade out and drop off the end. one instanced draw call. */

const CHAIN = 8;

// where block i settles, receding up-right and away from the camera
const targetX = (i: number) => 2.0 + i * 1.05;
const targetY = (i: number) => 0.55 + i * 0.3;
const targetZ = (i: number) => -0.7 - i * 0.95;

const VIOLET = new THREE.Color("#8b7cf6");
const tmpColor = new THREE.Color();

const Blocks = ({ shared }: { shared: SceneShared }) => {
  const mesh = useRef<THREE.InstancedMesh>(null);

  const state = useRef({
    age: new Float32Array(CHAIN).fill(-1), // -1 = empty seat
    pos: new Float32Array(CHAIN * 3),
    lastEject: 0,
    dummy: new THREE.Object3D(),
  });

  useFrame((frameState, delta) => {
    const m = mesh.current;
    if (!m) return;
    const s = state.current;
    const dt = Math.min(delta, 0.05);

    // slot closed → shift the chain, birth a new block at the core
    if (shared.eject.count !== s.lastEject) {
      s.lastEject = shared.eject.count;
      for (let i = CHAIN - 1; i >= 1; i--) {
        s.age[i] = s.age[i - 1];
        s.pos[i * 3] = s.pos[(i - 1) * 3];
        s.pos[i * 3 + 1] = s.pos[(i - 1) * 3 + 1];
        s.pos[i * 3 + 2] = s.pos[(i - 1) * 3 + 2];
      }
      s.age[0] = 0;
      s.pos[0] = 0;
      s.pos[1] = 0;
      s.pos[2] = 0;
    }

    const t = frameState.clock.elapsedTime;
    for (let i = 0; i < CHAIN; i++) {
      if (s.age[i] < 0) {
        s.dummy.position.set(0, 0, 9999);
        s.dummy.scale.setScalar(0.0001);
        s.dummy.updateMatrix();
        m.setMatrixAt(i, s.dummy.matrix);
        m.setColorAt(i, tmpColor.setScalar(0));
        continue;
      }
      s.age[i] += dt;

      // ease toward the chain seat
      const k = 1 - Math.exp(-3.2 * dt);
      s.pos[i * 3] += (targetX(i) - s.pos[i * 3]) * k;
      s.pos[i * 3 + 1] += (targetY(i) - s.pos[i * 3 + 1]) * k;
      s.pos[i * 3 + 2] += (targetZ(i) - s.pos[i * 3 + 2]) * k;

      // birth pop, then settle; the whole chain fades toward the tail
      const pop = s.age[i] < 0.35 ? 1 + Math.sin((s.age[i] / 0.35) * Math.PI) * 0.9 : 1;
      const fade = 1 - (i / CHAIN) * 0.75;
      s.dummy.position.set(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]);
      s.dummy.scale.setScalar(0.24 * pop * fade);
      s.dummy.rotation.set(t * 0.3 + i, t * 0.21 + i * 2.1, 0);
      s.dummy.updateMatrix();
      m.setMatrixAt(i, s.dummy.matrix);

      // fresh block flashes HDR-hot for the bloom, then cools into the chain
      const heat = 0.4 * fade + 2.6 * Math.exp(-s.age[i] * 3.5);
      m.setColorAt(i, tmpColor.copy(VIOLET).multiplyScalar(heat));
    }

    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CHAIN]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial wireframe toneMapped={false} />
    </instancedMesh>
  );
};

export default Blocks;
