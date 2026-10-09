import * as THREE from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import helvetiker from 'three/examples/fonts/helvetiker_bold.typeface.json';

/**
 * Laser-etched "CAMAC" on a flat front panel of the cabin, stacked vertically, letter by letter.
 * Each letter is real 3D letter geometry (extruded from a bold sans font) and grows down from its
 * top edge as the laser burns it. The burn point throws sparks. A letter glows while it is cut,
 * then settles into its final colour.
 */

const WORD = ['C', 'A', 'M', 'A', 'C'];
const PITCH = 1.28; // line pitch relative to the cap height
const FONT = new Font(helvetiker);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Letter geometry at the given size, its top edge at y = 0 and centred on x = 0. */
function letterGeometry(ch, size, depth) {
  const g = new TextGeometry(ch, { font: FONT, size, depth, curveSegments: 6, bevelEnabled: false });
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.max.y, 0);
  g.computeBoundingBox();
  return g;
}

/**
 * panel: { cx, cy, zFace, width, height } in outer units. The sign sits on the front face (zFace).
 * windowStart / windowEnd: progress range in which the whole word is cut.
 */
export function createLaserSign({ fx, panel, windowStart, windowEnd }) {
  // Size: the stack has to fit the panel both ways.
  const probe = WORD.map((ch) => {
    const g = letterGeometry(ch, 1, 0);
    return g.boundingBox.max.x - g.boundingBox.min.x;
  });
  const widest = Math.max(...probe);
  const capH1 = letterGeometry('A', 1, 0).boundingBox.max.y - letterGeometry('A', 1, 0).boundingBox.min.y;
  const stackUnits = capH1 * (PITCH * (WORD.length - 1) + 1);
  const k = Math.min((panel.height * 0.8) / stackUnits, (panel.width * 0.7) / widest);
  const capH = capH1 * k;
  const depth = capH * 0.05;

  const group = new THREE.Group();
  group.position.set(panel.cx, panel.cy, panel.zFace + 0.002);
  group.visible = false;

  const stackTop = (WORD.length - 1) * PITCH * capH + capH; // from the top of the first letter to the bottom of the last
  const letters = WORD.map((ch, i) => {
    const geometry = letterGeometry(ch, k, depth);
    const material = new THREE.MeshStandardMaterial({
      color: '#d9b24a',
      metalness: 0.7,
      roughness: 0.32,
      emissive: new THREE.Color('#ffb000'),
      emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = stackTop / 2 - i * PITCH * capH; // centred on the panel, top edge of each letter
    mesh.scale.y = 0.0001;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, top: mesh.position.y };
  });

  // Each letter gets an equal share of the window; the next one starts when the previous is done.
  const span = Math.max(1e-6, windowEnd - windowStart);
  const share = span / WORD.length;
  let sparkT = 0;

  function update(progress, dt) {
    group.visible = progress >= windowStart;
    let burning = null;
    letters.forEach((L, i) => {
      const a = windowStart + i * share;
      const q = clamp01((progress - a) / share);
      L.mesh.visible = q > 0;
      L.mesh.scale.y = Math.max(0.0001, easeOut(q));
      // glows while it is cut, then settles to a warm metal
      L.material.emissiveIntensity = q <= 0 ? 0 : q < 1 ? 1.2 * Math.sin(Math.PI * q) + 0.1 : 0.05;
      if (q > 0 && q < 1) burning = { L, q };
    });

    if (burning) {
      sparkT += dt;
      if (sparkT > 0.04) {
        sparkT = 0;
        const { L, q } = burning;
        // the burn point: the bottom edge of the letter that is growing
        const y = panel.cy + L.top - capH * q * 0.95;
        fx.emit({
          x: panel.cx + (Math.random() - 0.5) * capH * 1.2,
          y,
          z: panel.zFace + depth + 0.01,
          nx: 0,
          ny: 0,
          nz: 1,
          dust: 0,
          sparks: 0.6,
          shake: 0,
        });
      }
    } else {
      sparkT = 0;
    }
  }

  return { group, update };
}
