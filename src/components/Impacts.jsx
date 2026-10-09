import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { fx } from '../lib/fx';

/**
 * Impact particles rendered with a soft-circle shader (no square sprites):
 *  - dust      : warm-grey puffs that expand, drift and fade with soft edges
 *  - sparkCore : white-hot, additive points that cool to orange
 *  - sparkGlow : large dim additive halos around the sparks
 * All clouds live inside the model's unit-space group.
 */

const vert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.2, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float core = pow(1.0 - d, 2.2);
  gl_FragColor = vec4(vColor, core * vAlpha);
}`;

const DUST = [0.86, 0.83, 0.76];
const ORANGE = [1.0, 0.55, 0.12];
const WHITE_HOT = [1.0, 0.97, 0.85];

class Cloud {
  constructor({ max, additive, depthWrite = false }) {
    this.max = max;
    this.cursor = 0;
    this.pool = Array.from({ length: max }, () => ({
      alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, s0: 0.05, s1: 0.1, a0: 0.5, drag: 1, grav: 0,
      r: 1, g: 1, b: 1, hot: false, gain: 1,
    }));
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      depthWrite,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.raycast = () => null; // effects must never capture pointer events
    this.geo = geo;
  }

  spawn(o) {
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    Object.assign(p, { alive: true, life: o.life, maxLife: o.life, gain: 1, hot: false }, o);
  }

  step(dt) {
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.vy = p.vy * damp - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < -1.0 && p.grav > 0) { // ground: spark bounces and stops
        p.y = -1.0;
        p.vy = -p.vy * 0.2;
      }

      const k = Math.max(0, p.life / p.maxLife); // 1 → 0 over life
      const age = 1 - k;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.size[n] = p.s0 + (p.s1 - p.s0) * age;
      this.alpha[n] = p.a0 * Math.pow(k, 1.4) * p.gain;
      if (p.hot) {
        // sparks: white-hot at birth, cooling to orange
        const m = age < 0.35 ? 0 : (age - 0.35) / 0.65;
        for (let c = 0; c < 3; c++) {
          this.col[n * 3 + c] = WHITE_HOT[c] + (ORANGE[c] - WHITE_HOT[c]) * m;
        }
      } else {
        this.col[n * 3] = p.r;
        this.col[n * 3 + 1] = p.g;
        this.col[n * 3 + 2] = p.b;
      }
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

export default function Impacts() {
  const { camera, gl } = useThree();
  const clouds = useMemo(() => ({
    dust: new Cloud({ max: 4200, additive: false }),
    core: new Cloud({ max: 4000, additive: true }),
    glow: new Cloud({ max: 2800, additive: true }),
  }), []);

  useFrame((_, dt) => {
    const step = Math.min(dt, 1 / 30);
    clouds.dust.material.uniforms.uScale.value = gl.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    clouds.core.material.uniforms.uScale.value = clouds.dust.material.uniforms.uScale.value;
    clouds.glow.material.uniforms.uScale.value = clouds.dust.material.uniforms.uScale.value;

    while (fx.queue.length) spawnImpact(clouds, fx.queue.shift());

    clouds.dust.step(step);
    clouds.core.step(step);
    clouds.glow.step(step);
  });

  return (
    <group>
      <primitive object={clouds.dust.points} />
      <primitive object={clouds.glow.points} />
      <primitive object={clouds.core.points} />
    </group>
  );
}

/**
 * Turns one impact event into a directional burst:
 *  - a flash puff at the contact point
 *  - dust that bursts back along the incoming direction (the surface it hit) and spreads out
 *  - white-hot sparks that fan out in a cone, cooling to orange, with glow halos
 * e.nx/ny/nz is the incoming direction (unit, outer space).
 */
function spawnImpact(clouds, e) {
  const n = new THREE.Vector3(e.nx ?? 0, e.ny ?? 1, e.nz ?? 0).normalize();
  const rnd3 = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
  const at = new THREE.Vector3(e.x, e.y, e.z);

  // flash
  clouds.glow.spawn({
    x: e.x, y: e.y, z: e.z, vx: 0, vy: 0, vz: 0, life: 0.12,
    s0: 0.22 * (0.6 + e.dust), s1: 0.4, a0: 0.3, drag: 4, grav: 0, r: 1, g: 0.97, b: 0.88,
  });

  const dustN = Math.min(40, Math.round(4 + 18 * e.dust));
  for (let i = 0; i < dustN; i++) {
    // mostly spray back toward the incoming side, with a wide spread
    const d = n.clone().multiplyScalar(0.7 + Math.random() * 0.5).add(rnd3().multiplyScalar(1.1)).normalize();
    const sp = (0.3 + Math.random() * 1.1) * (0.6 + 0.5 * e.dust);
    const p = at.clone().addScaledVector(n, 0.02).add(rnd3().multiplyScalar(0.12));
    const s0 = 0.04 + Math.random() * 0.07;
    clouds.dust.spawn({
      x: p.x, y: p.y, z: p.z,
      vx: d.x * sp, vy: d.y * sp + 0.05, vz: d.z * sp,
      life: 1.5 + Math.random() * 1.6,
      s0,
      s1: s0 * (3 + Math.random() * 3),
      a0: 0.14 + Math.random() * 0.08,
      drag: 1.6,
      grav: -0.015,
      r: DUST[0] + (Math.random() - 0.5) * 0.05,
      g: DUST[1] + (Math.random() - 0.5) * 0.05,
      b: DUST[2] + (Math.random() - 0.5) * 0.05,
    });
  }

  const sparkN = Math.min(26, Math.round(4 + 11 * e.sparks));
  for (let i = 0; i < sparkN; i++) {
    // fan of sparks around the outgoing direction
    const d = n.clone().multiplyScalar(0.8 + Math.random() * 0.4).add(rnd3().multiplyScalar(1.3)).normalize();
    const speed = (1.6 + Math.random() * 3.2) * (0.6 + 0.5 * e.sparks);
    const life = 0.3 + Math.random() * 0.8;
    const base = {
      x: e.x + (Math.random() - 0.5) * 0.04,
      y: e.y + (Math.random() - 0.5) * 0.04,
      z: e.z + (Math.random() - 0.5) * 0.04,
      vx: d.x * speed,
      vy: d.y * speed,
      vz: d.z * speed,
      life,
      drag: 0.7,
      grav: 5.0,
      hot: true,
    };
    clouds.core.spawn({ ...base, s0: 0.014, s1: 0.005, a0: 1.0, gain: 1 });
    clouds.glow.spawn({ ...base, s0: 0.04, s1: 0.015, a0: 0.1, gain: 1 });
  }
}
