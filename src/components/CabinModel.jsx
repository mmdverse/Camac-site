import { useGLTF, Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { store } from '../lib/store';
import { createAssembly } from '../lib/assembly';
import { normalizeNodeName } from '../lib/nodeName';
import { fx } from '../lib/fx';
import Impacts from './Impacts';
import { useStore } from '../lib/useStore';

// Draco decoder is served from /public so the bundle stays small and works offline.
useGLTF.setDecoderPath('/draco/gltf/');

/** Chooses the quality tier: mobile devices or ?quality=low get the 1024px texture build. */
function pickModelUrl(model) {
  if (typeof model === 'string') return model;
  const params = new URLSearchParams(window.location.search);
  const lowQuality = params.get('quality') === 'low';
  const mobile = window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
  return lowQuality || mobile ? model.mobile : model.desktop;
}

const HIGHLIGHT_COLOR = new THREE.Color('#bcd9ef');
const HIGHLIGHT_STRENGTH = 0.22;

/**
 * Loads a cabin GLB, normalises it to a unit-sized box centred at the origin,
 * registers interactive part groups (by exact node name), and handles hover/click
 * highlighting plus the in-scene HUD label.
 */
export default function CabinModel({ cabin, onReady }) {
  const { scene } = useGLTF(pickModelUrl(cabin.model));
  const outer = useRef();
  const partsRef = useRef([]);
  const partByObject = useRef(new Map());
  const assemblyRef = useRef(null);
  const hovered = useStore((s) => s.hovered);
  const selected = useStore((s) => s.selected);
  // HUD follows the hovered part, or the selected one when nothing is hovered.
  const hudId = hovered ?? selected;
  const hudInfo = hudId ? partsRef.current.find((p) => p.id === hudId) : null;

  useLayoutEffect(() => {
    const g = outer.current;
    if (!g) return;

    // The source file marks some parts as pure green; recolour them to safety yellow once,
    // and tag every yellow mesh so the assembly can give it a follow-camera move.
    if (!scene.userData.recolored) {
      scene.userData.recolored = true;
      scene.traverse((o) => {
        if (!o.isMesh) return;
        let yellow = false;
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          const c = mat.color;
          if (!c) continue;
          if (c.g > 0.5 && c.r < 0.35 && c.b < 0.35) mat.color.set('#ffc21a');
          if (c.r > 0.85 && c.g > 0.4 && c.b < 0.3) yellow = true;
        }
        if (yellow) o.userData.yellow = true;
      });
    }

    // 1. Normalise: whole model -> max dimension 2 units, centred at origin.
    g.position.set(0, 0, 0);
    g.scale.setScalar(1);
    scene.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(scene);
    const rawSize = raw.getSize(new THREE.Vector3());
    const s = 2 / Math.max(rawSize.x, rawSize.y, rawSize.z);
    const c = raw.getCenter(new THREE.Vector3());
    g.scale.setScalar(s);
    g.position.copy(c).multiplyScalar(-s);
    g.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene);

    // 2. Register interactive parts by exact node name (data-driven, see data/cabins.js).
    const parts = [];
    const map = new Map();
    cabin.parts.forEach((def) => {
      let root = null;
      scene.traverse((o) => {
        if (!root && normalizeNodeName(o.name) === normalizeNodeName(def.match)) root = o;
      });
      if (!root) {
        console.warn(`[CAMAC] part "${def.match}" not found in GLB`);
        return;
      }
      const meshes = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        if (!o.userData.prepared) {
          // Clone once per mesh so highlight does not leak into shared materials.
          o.material = Array.isArray(o.material)
            ? o.material.map((m) => m.clone())
            : o.material.clone();
          o.userData.prepared = true;
        }
        meshes.push(o);
      });
      const box = new THREE.Box3().setFromObject(root);
      parts.push({
        id: def.id,
        label: def.label,
        title: def.title,
        description: def.description,
        root,
        meshes,
        center: box.getCenter(new THREE.Vector3()),
        size: box.getSize(new THREE.Vector3()).length(),
        weight: 0,
      });
      map.set(root, def.id);
    });

    partsRef.current = parts;
    partByObject.current = map;

    // 3. Cinematic assembly controller (built before any node is hidden/moved).
    assemblyRef.current = createAssembly({ outer: g, scene, phases: cabin.assembly, fx });
    // share the scroll map and the auto-scroll stops with the page
    store.set({ sequence: { map: assemblyRef.current.scrollMap, stops: assemblyRef.current.stops } });
    window.dispatchEvent(new Event('scroll')); // re-sync progress with the current scroll position
    const partBoxes = new Map(parts.map((p) => [p.id, { center: p.center, size: p.size }]));
    onReady?.({ bounds, partBoxes });
  }, [scene, cabin, onReady]);

  // Smooth highlight: per-part weight eases towards 1 when hovered/selected.
  useFrame((_, dt) => {
    assemblyRef.current?.update(store.progress, dt, fx.idle);
    // While a piece is shown or landing, the cabin turns so the seat faces the camera; then it returns.
    const v = fx.view;
    const tYaw = v.active ? v.yaw : 0;
    const tPitch = v.active ? v.pitch : 0;
    const kv = 1 - Math.exp(-dt * 2.2);
    const g = outer.current;
    if (g) {
      g.rotation.y += Math.atan2(Math.sin(tYaw - g.rotation.y), Math.cos(tYaw - g.rotation.y)) * kv;
      g.rotation.x += (tPitch - g.rotation.x) * kv;
    }
    const k = 1 - Math.exp(-dt * 10);
    for (const p of partsRef.current) {
      const target = p.id === store.hovered || p.id === store.selected ? 1 : 0;
      p.weight += (target - p.weight) * k;
      for (const m of p.meshes) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (!mat.emissive) continue;
          mat.emissive.copy(HIGHLIGHT_COLOR);
          mat.emissiveIntensity = p.weight * HIGHLIGHT_STRENGTH;
        }
      }
    }
  });

  const resolvePart = (obj) => {
    if (!store.assembled) return null; // parts are interactive only once the cabin is complete
    let o = obj;
    while (o) {
      const id = partByObject.current.get(o);
      if (id) return id;
      o = o.parent;
    }
    return null;
  };

  const handlers = {
    onPointerMove: (e) => {
      e.stopPropagation();
      const id = resolvePart(e.object);
      if (id !== store.hovered) store.set({ hovered: id });
      document.body.style.cursor = id ? 'pointer' : 'auto';
    },
    onPointerOut: () => {
      store.set({ hovered: null });
      document.body.style.cursor = 'auto';
    },
    onClick: (e) => {
      e.stopPropagation();
      const id = resolvePart(e.object);
      if (!id) return;
      store.set({ selected: store.selected === id ? null : id });
    },
  };

  return (
    <group ref={outer} {...handlers}>
      <primitive object={scene} />
      <Impacts />
      {hudInfo && (
        <Html position={hudInfo.center.toArray()} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="hud-label">
            <span className="hud-dot" />
            <span className="hud-text">{hudInfo.label}</span>
          </div>
        </Html>
      )}
    </group>
  );
}
