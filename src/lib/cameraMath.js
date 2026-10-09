import * as THREE from 'three';

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Sample a camera path at `progress` (0..1).
 * Keyframes are relative to the model (see data/cabins.js). Returns world-space values
 * given the model centre and its characteristic size R.
 */
export function sampleCameraPath(path, progress, center, R, out) {
  const p = Math.min(1, Math.max(0, progress));
  let i = 0;
  while (i < path.length - 2 && p > path[i + 1].progress) i++;
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  const span = Math.max(1e-6, b.progress - a.progress);
  const t = smoothstep(Math.min(1, Math.max(0, (p - a.progress) / span)));

  out.pos.set(
    center.x + R * THREE.MathUtils.lerp(a.pos[0], b.pos[0], t),
    center.y + R * THREE.MathUtils.lerp(a.pos[1], b.pos[1], t),
    center.z + R * THREE.MathUtils.lerp(a.pos[2], b.pos[2], t),
  );
  out.target.set(
    center.x + R * THREE.MathUtils.lerp(a.target[0], b.target[0], t),
    center.y + R * THREE.MathUtils.lerp(a.target[1], b.target[1], t),
    center.z + R * THREE.MathUtils.lerp(a.target[2], b.target[2], t),
  );
  out.fov = THREE.MathUtils.lerp(a.fov, b.fov, t);
  return out;
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
