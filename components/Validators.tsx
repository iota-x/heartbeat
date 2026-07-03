"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { SceneShared } from "@/lib/sceneState";

/* the validator ring: a constellation of nodes on the network edge, joined
 * by a faint loop. every slot close one node — picked deterministically
 * from the real slot number, so every viewer sees the same one — flashes
 * as that slot's leader. two draw calls (instances + line loop). */

const N = 48;
const RADIUS = 10.6;

const nodeX = (i: number) => Math.cos((i / N) * Math.PI * 2) * RADIUS;
const nodeY = (i: number) => Math.sin((i / N) * Math.PI * 2) * RADIUS * 0.6;
const nodeZ = (i: number) => Math.sin((i / N) * Math.PI * 6) * 0.9;

const BASE = new THREE.Color("#3d3860");
const HOT = new THREE.Color("#c4b5fd").multiplyScalar(3.2);
const tmpColor = new THREE.Color();

const Validators = ({ shared }: { shared: SceneShared }) => {
  const mesh = useRef<THREE.InstancedMesh>(null);

  const state = useRef({
    flashAge: new Float32Array(N).fill(99),
    lastEject: 0,
    dummy: new THREE.Object3D(),
  });

  const loopGeometry = useMemo(() => {
    const pos = new Float32Array((N + 1) * 3);
    for (let i = 0; i <= N; i++) {
      pos[i * 3] = nodeX(i % N);
      pos[i * 3 + 1] = nodeY(i % N);
      pos[i * 3 + 2] = nodeZ(i % N);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame((frameState, delta) => {
    const m = mesh.current;
    if (!m) return;
    const s = state.current;

    if (shared.eject.count !== s.lastEject) {
      s.lastEject = shared.eject.count;
      s.flashAge[shared.eject.slot % N] = 0;
    }

    const t = frameState.clock.elapsedTime;
    for (let i = 0; i < N; i++) {
      s.flashAge[i] += delta;
      const heat = Math.exp(-s.flashAge[i] * 3);
      s.dummy.position.set(
        nodeX(i),
        nodeY(i) + Math.sin(t * 0.6 + i * 1.7) * 0.12, // slow bob
        nodeZ(i),
      );
      s.dummy.scale.setScalar(0.09 * (1 + heat * 2.2));
      s.dummy.rotation.set(0, t * 0.4 + i, 0);
      s.dummy.updateMatrix();
      m.setMatrixAt(i, s.dummy.matrix);
      m.setColorAt(i, tmpColor.copy(BASE).lerp(HOT, Math.min(1, heat)));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, undefined, N]} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <lineLoop geometry={loopGeometry} frustumCulled={false}>
        <lineBasicMaterial
          color="#2a2444"
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </lineLoop>
    </group>
  );
};

export default Validators;
