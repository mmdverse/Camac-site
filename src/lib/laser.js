import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Laser-etched CAMAC sign on the front face of the cabin, written top to bottom.
 * Letters are built from rectangles (block glyphs), extruded into thin relief, and revealed by a
 * bright laser line that sweeps down the sign. The line throws sparks as it moves.
 */

// Block glyphs on a 3 x 5 grid: [x, y, width, height] rectangles.
const GLYPHS = {
  C: [[0, 4, 3, 1], [0, 0, 1, 5], [0, 0, 3, 1]],
  A: [[0, 0, 1, 5], [2, 0, 1, 5], [0, 4, 3, 1], [0, 2, 3, 1]],
  M: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 2, 1, 2]],
};
const WORD = ['C', 'A', 'M', 'A', 'C'];
const GW = 3; // glyph width
const GH = 5; // glyph height
const GAP = 1.5; // gap between letters
const TOTAL = WORD.length * GH + (WORD.length - 1) * GAP; // 31 grid units tall

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function createLaserSign({ fx, cx, cy, zFace, height, windowStart, windowEnd }) {
  const s = height / TOTAL; // grid unit -> outer units

  // 1. Geometry: all glyph rectangles, extruded, centred on the origin, letters stacked top to bottom.
  const parts = [];
  WORD.forEach((ch, k) => {
    const top = TOTAL / 2 - k * (GH + GAP);
    const bottom = top - GH;
    for (const [rx, ry, rw, rh] of GLYPHS[ch]) {
      const x0 = rx - GW / 2;
      const y0 = bottom + ry;
      const shape = new THREE.Shape();
      shape.moveTo(x0, y0);
      shape.lineTo(x0 + rw, y0);
      shape.lineTo(x0 + rw, y0 + rh);
      shape.lineTo(x0, y0 + rh);
      shape.closePath();
      parts.push(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }));
    }
  });
  const geometry = mergeGeometries(parts);

  // 2. Material: revealed from the top down; a bright line rides on the reveal edge.
  const uniforms = {
    uReveal: { value: 0 },
    uTop: { value: TOTAL / 2 },
    uBottom: { value: -TOTAL / 2 },
    uColor: { value: new THREE.Color('#ffd23a') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: `
      varying float vY;
      void main() {
        vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uReveal;
      uniform float uTop;
      uniform float uBottom;
      uniform vec3 uColor;
      varying float vY;
      void main() {
        float cut = mix(uTop, uBottom, uReveal);
        if (vY < cut - 0.0001) discard;
        float glow = exp(-abs(vY - cut) * 3.0);
        vec3 c = uColor * (0.6 + 0.4 * glow) + vec3(1.0, 0.95, 0.7) * glow * 1.4;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });

  // 3. Placement: on the front face, reading left to right, vertical stack of letters.
  const group = new THREE.Group();
  group.position.set(cx, cy, zFace + 0.004);
  group.scale.setScalar(s);
  group.add(new THREE.Mesh(geometry, material));
  group.visible = false;

  let sparkT = 0;

  function update(progress, dt) {
    const r = clamp01((progress - windowStart) / Math.max(1e-6, windowEnd - windowStart));
    group.visible = progress >= windowStart;
    uniforms.uReveal.value = r;
    if (r > 0 && r < 1) {
      sparkT += dt;
      if (sparkT > 0.04) {
        sparkT = 0;
        const y = cy + (uniforms.uTop.value + (uniforms.uBottom.value - uniforms.uTop.value) * r) * s;
        fx.emit({
          x: cx + (Math.random() - 0.5) * GW * s * 1.4,
          y,
          z: zFace + 0.01,
          nx: 0,
          ny: 0,
          nz: 1,
          dust: 0,
          sparks: 0.5,
          shake: 0,
        });
      }
    }
  }

  return { group, update };
}
