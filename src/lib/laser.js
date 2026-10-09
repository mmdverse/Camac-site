import * as THREE from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import helvetiker from 'three/examples/fonts/helvetiker_bold.typeface.json';

/**
 * Laser-etched "CAMAC" on a flat front panel, stacked vertically.
 * Letters are cut one at a time, top to bottom. A bright beam head scans each letter (zig-zag
 * passes), the cut edge glows and throws sparks, and the letter cools to a warm metal once done.
 * The camera moves in front of each letter while it is being cut.
 */

const WORD = ['C', 'A', 'M', 'A', 'C'];
const PITCH = 1.28; // line pitch relative to the cap height
const PASSES = 3; // zig-zag scan passes of the beam head over each letter
const FONT = new Font(helvetiker);

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Letter geometry at the given size, its top edge at y = 0 and centred on x = 0. */
function letterGeometry(ch, size, depth) {
  const g = new TextGeometry(ch, { font: FONT, size, depth, curveSegments: 6, bevelEnabled: false });
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.max.y, 0);
  g.computeBoundingBox();
  return g;
}

const VERT = `
  varying vec3 vPos;
  varying vec3 vN;
  void main() {
    vPos = position;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Fragments below the cut line are not cut yet (hidden). Above it the metal is burned; the cut edge glows.
const FRAG = `
  uniform float uCut;
  uniform float uTop;
  uniform float uBottom;
  uniform float uGlow;
  uniform float uFalloff;
  uniform vec3 uColor;
  varying vec3 vPos;
  varying vec3 vN;
  void main() {
    float cut = mix(uTop, uBottom, uCut);
    if (vPos.y < cut - 0.0005) discard;
    float edge = exp(-abs(vPos.y - cut) * uFalloff);
    float shade = 0.72 + 0.28 * clamp(vN.z, 0.0, 1.0);
    vec3 base = uColor * shade;
    vec3 hot = vec3(1.0, 0.82, 0.42) * 2.2;
    vec3 c = mix(base, hot, edge * uGlow);
    gl_FragColor = vec4(c, 1.0);
  }`;

/**
 * Polished metal for the letters, lit by the scene like the rest of the cabin. The cut (hidden below the
 * cut line) and the hot edge are added on top of the standard shading.
 */
function cutMaterial(uniforms) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#d6ac4e',
    metalness: 0.92,
    roughness: 0.22,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLp = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uCut; uniform float uTop; uniform float uBottom; uniform float uGlow; uniform float uFalloff;
        varying vec3 vLp;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float cutY = mix(uTop, uBottom, uCut);
        if (vLp.y < cutY - 0.0005) discard;
        float edgeG = exp(-abs(vLp.y - cutY) * uFalloff);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.82, 0.42) * 2.2 * edgeG * uGlow;`,
      );
  };
  return mat;
}

/**
 * panel: { cx, cy, zFace, width, height } in outer units. The sign sits on the front face (zFace).
 * windowStart / windowEnd: progress range in which the whole word is cut.
 * toWorld: converts an outer-space point to world space (the camera works in world space).
 */
export function createLaserSign({ fx, toWorld, panel, windowStart, windowEnd }) {
  // Size: the stack has to fit the panel both ways.
  const widths1 = WORD.map((ch) => {
    const g = letterGeometry(ch, 1, 0);
    return g.boundingBox.max.x - g.boundingBox.min.x;
  });
  const widest = Math.max(...widths1);
  const probeA = letterGeometry('A', 1, 0).boundingBox;
  const capH1 = probeA.max.y - probeA.min.y;
  const stackUnits = capH1 * (PITCH * (WORD.length - 1) + 1);
  const k = Math.min((panel.height * 0.8) / stackUnits, (panel.width * 0.7) / widest);
  const capH = capH1 * k;
  const depth = capH * 0.05;
  const dist = capH * 4.5; // camera distance from a letter while it is cut

  const group = new THREE.Group();
  group.position.set(panel.cx, panel.cy, panel.zFace + 0.002);
  group.visible = false;

  const stackTop = (WORD.length - 1) * PITCH * capH + capH;
  const share = Math.max(1e-6, windowEnd - windowStart) / WORD.length;

  const letters = WORD.map((ch, i) => {
    const geometry = letterGeometry(ch, k, depth);
    const uniforms = {
      uCut: { value: 0 },
      uTop: { value: 0 },
      uBottom: { value: -capH },
      uGlow: { value: 0 },
      uFalloff: { value: 35 / Math.max(capH, 1e-4) },
      uColor: { value: new THREE.Color('#c9a24a') },
    };
    const material = cutMaterial(uniforms);
    const mesh = new THREE.Mesh(geometry, material);
    const top = stackTop / 2 - i * PITCH * capH;
    mesh.position.y = top;
    mesh.visible = false;
    group.add(mesh);
    const a = windowStart + i * share;
    const w = (geometry.boundingBox.max.x - geometry.boundingBox.min.x) / 2;
    return { mesh, uniforms, top, a, b: a + share, halfW: w };
  });

  // The beam head: a small bright point that scans the letter being cut.
  const beam = new THREE.Mesh(
    new THREE.SphereGeometry(capH * 0.07, 12, 8),
    new THREE.MeshBasicMaterial({ color: '#fff3c0', toneMapped: false }),
  );
  beam.visible = false;
  group.add(beam);

  let sparkT = 0;

  function activeLetter(progress) {
    for (let i = 0; i < letters.length; i++) {
      const L = letters[i];
      if (progress >= L.a && progress < L.b) return i;
    }
    return -1;
  }

  /** Camera for letter i, in world space: in front of the letter, slightly from the side. */
  function viewFor(i) {
    const L = letters[i];
    const centre = new THREE.Vector3(group.position.x, group.position.y + L.top - capH / 2, group.position.z + depth / 2);
    const dir = new THREE.Vector3(0.2, 0.08, 1).normalize();
    const pos = centre.clone().addScaledVector(dir, dist);
    return { pos: toWorld(pos), target: toWorld(centre) };
  }

  function update(progress, dt) {
    group.visible = progress >= windowStart;
    let head = null;
    letters.forEach((L, i) => {
      const q = clamp01((progress - L.a) / share);
      L.mesh.visible = q > 0;
      L.uniforms.uCut.value = q;
      // while being cut the edge is hot; afterwards the letter keeps a faint warm glow
      L.uniforms.uGlow.value = q <= 0 ? 0 : q < 1 ? 1 : 0.08;
      if (q > 0 && q < 1) head = { L, q, i };
    });

    if (head) {
      const { L, q } = head;
      // the beam scans the letter with zig-zag passes, moving down as it cuts
      const xs = Math.sin(q * PASSES * Math.PI * 2) * L.halfW * 0.85;
      const y = L.top - q * capH;
      beam.visible = true;
      beam.position.set(xs, y, depth + 0.004);
      sparkT += dt;
      if (sparkT > 0.03) {
        sparkT = 0;
        fx.emit({
          x: group.position.x + xs + (Math.random() - 0.5) * capH * 0.2,
          y: group.position.y + y,
          z: group.position.z + depth + 0.01,
          nx: 0,
          ny: 0,
          nz: 1,
          dust: 0.04,
          sparks: 0.7,
          shake: 0,
        });
      }
    } else {
      beam.visible = false;
      sparkT = 0;
    }
  }

  return { group, update, activeLetter, viewFor };
}
