"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { SceneShared } from "@/lib/sceneState";

/* expanding ring on every slot close — makes the 400ms heartbeat legible
 * even in a muted autoplay clip. one reused mesh, no allocations. */

const LIFE_S = 1.1;

const Shockwave = ({ shared }: { shared: SceneShared }) => {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const state = useRef({ t: LIFE_S, lastEject: 0 });

  useFrame((_, delta) => {
    const s = state.current;
    if (shared.eject.count !== s.lastEject) {
      s.lastEject = shared.eject.count;
      s.t = 0;
    }
    s.t += delta;
    const m = mesh.current;
    const material = mat.current;
    if (!m || !material) return;
    const k = Math.min(1, s.t / LIFE_S);
    if (k >= 1) {
      m.visible = false;
      return;
    }
    m.visible = true;
    const ease = 1 - (1 - k) * (1 - k); // fast out, settling
    m.scale.setScalar(1 + ease * 9);
    material.opacity = (1 - k) * (1 - k) * 0.22;
  });

  return (
    <mesh ref={mesh} visible={false}>
      {/* nearly-degenerate ring: stays a thin line even at 10× scale */}
      <ringGeometry args={[0.985, 1, 96]} />
      <meshBasicMaterial
        ref={mat}
        color="#a78bfa"
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};

export default Shockwave;
