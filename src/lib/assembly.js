import * as THREE from 'three';
import { normalizeNodeName } from './nodeName';
import { createLaserSign } from './laser';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SMALL = 0.25; // pieces smaller than this are fasteners: they are grouped and pop in
const GROUP = 4; // fasteners per group (they land together)
const FLIGHT = 0.5; // share of each slot used by the flight; the rest is a pause on the landed piece
const SMALL_WEIGHT = 2.5; // scroll distance per unit of progress over medium/small pieces (x2.5: slower)
const POP_FLIGHT = 0.85; // share of the slot used by a fastener's pop-in
const MID_FLIGHT = 0.7; // share of the slot used by a medium piece's flight (softer than big ones)
const TRAIN_GAP = 0.15; // share of a slot between two fasteners of one train
const TRAIN_FLIGHT = 0.55; // share of a slot each fastener spends flying in
const TRAIN_WEIGHT = 1.5; // slow motion: the train takes much longer to scroll through // a fastener train takes longer to scroll through
const TRAIN_REACH = 1.2; // how far out along the lane a fastener starts
const FOCUS_CHANCE = 0.3; // share of medium/big pieces that get their own camera focus (manual scroll only)
const STOP_AT = 0.35; // where in its flight an auto-scroll stop lands
const GLOW = new THREE.Color('#ffd27a');
const LASER_HOST = 'Panel_R_2'; // the grey front panel beside the door where CAMAC is engraved
// Fastener regions are finished one at a time, in this order.
const ZONE_ORDER = ['bottom', 'front', 'right', 'back', 'left', 'top'];

/** Smooth in-out: slow start, gentle middle, slow landing. */
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Flight directions in outer (unit) space. Pieces come from every side, not only from above:
 * left, right, front (camera side), back, above, and several diagonals.
 */
const SIDES = [
  new THREE.Vector3(-1, 0.25, 0.1),
  new THREE.Vector3(1, 0.25, -0.1),
  new THREE.Vector3(0.1, 0.2, 1),
  new THREE.Vector3(-0.1, 0.2, -1),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0.8, 0.7, 0.8),
  new THREE.Vector3(-0.8, 0.5, 0.9),
  new THREE.Vector3(0.9, 0.35, -0.8),
  new THREE.Vector3(-0.9, 0.9, -0.6),
];

const ORDERS = {
  bottomUp: (i) => i.center.y,
  topDown: (i) => -i.center.y,
  centerOut: (i) => Math.hypot(i.center.x, i.center.z),
  // walks around the model: left wall, right wall, back wall, ...
  ring: (i) => Math.atan2(i.center.x, i.center.z),
};

/**
 * Per-mesh cinematic assembly on the original GLB hierarchy.
 *
 * One global timeline, strictly sequential: big pieces first (they spin in and lock), then the
 * fasteners in small groups. Each piece:
 *  - starts hidden, flies in from its own side with an eased path, and glows while in the air
 *  - lands with an impact at its contact point, then pauses before the next one starts
 *  - gets a camera move (wide, orbit, or follow for yellow pieces)
 */
export function createAssembly({ outer, scene, phases, fx }) {
  outer.updateMatrixWorld(true);
  const outerInv = new THREE.Matrix4().copy(outer.matrixWorld).invert();
  const s = outer.scale.x; // uniform normalisation scale (world -> outer units)
  const zero = new THREE.Vector3();

  const byName = new Map();
  scene.traverse((o) => {
    if (!o.name) return;
    const key = normalizeNodeName(o.name);
    const list = byName.get(key) ?? [];
    list.push(o);
    byName.set(key, list);
  });

  // 1. Collect every mesh, phase by phase, in its own order.
  const used = new Set();
  const queue = []; // { m, phase, phaseIdx, info }
  phases.forEach((phase, phaseIdx) => {
    const meshes = [];
    for (const name of phase.targets) {
      for (const root of byName.get(normalizeNodeName(name)) ?? []) {
        root.traverse((o) => {
          if (o.isMesh && !used.has(o)) {
            used.add(o);
            meshes.push(o);
          }
        });
      }
    }
    const infos = meshes.map((m) => {
      const box = new THREE.Box3().setFromObject(m);
      const center = box.getCenter(new THREE.Vector3()).applyMatrix4(outerInv);
      const size = box.getSize(new THREE.Vector3()).length() / s;
      return { m, center, size, outerBox: box.clone().applyMatrix4(outerInv) };
    });
    const key = ORDERS[phase.order] ?? (() => 0);
    infos.sort((a, b) => key(a) - key(b));
    infos.forEach((info) => queue.push({ phase, phaseIdx, info }));
  });

  // Camera zones: the camera moves once per zone (top, front, right, back, left, bottom), not for each piece.
  const cabinC = new THREE.Vector3();
  queue.forEach((it) => cabinC.add(it.info.center));
  cabinC.divideScalar(Math.max(1, queue.length));
  // Three-quarter views: each zone is seen from its side, rotated a little so the seats show.
  const ZONE_DIRS = {
    top: [0.25, 1, 0.45],
    bottom: [0.3, -0.6, 1],
    front: [0.35, 0.3, 1],
    right: [1, 0.3, 0.35],
    back: [-0.35, 0.3, -1],
    left: [-1, 0.3, -0.35],
  };
  const ZONE_DIST = { top: 3.1, bottom: 2.9, front: 2.7, right: 2.7, back: 2.7, left: 2.7 };
  const zoneOf = (c) => {
    const rel = c.clone().sub(cabinC);
    const horiz = Math.hypot(rel.x, rel.z);
    if (rel.y > horiz * 1.2) return 'top';
    if (rel.y < -horiz * 1.2) return 'bottom';
    const a = Math.atan2(rel.x, rel.z); // 0 = front (+z)
    if (Math.abs(a) < Math.PI / 4) return 'front';
    if (Math.abs(a) > (3 * Math.PI) / 4) return 'back';
    return a > 0 ? 'right' : 'left';
  };
  // Where each zone's pieces sit (outer space), so the camera aims at the action, not at the middle of the air.
  const zoneCentroid = new Map();
  for (const it of queue) {
    const z = zoneOf(it.info.center);
    const e = zoneCentroid.get(z) ?? { sum: new THREE.Vector3(), n: 0 };
    e.sum.add(it.info.center);
    e.n++;
    zoneCentroid.set(z, e);
  }
  // World-space camera for a zone: from that side, aimed half-way between the zone and the whole cabin,
  // so the full cabin stays in frame.
  const zoneView = (name) => {
    const e = zoneCentroid.get(name);
    const zc = e ? e.sum.clone().divideScalar(e.n) : cabinC.clone();
    const aimOuter = cabinC.clone().lerp(zc, 0.5);
    const c = outer.localToWorld(aimOuter.clone());
    const d = outer
      .localToWorld(aimOuter.clone().add(new THREE.Vector3(...ZONE_DIRS[name]).normalize()))
      .sub(c)
      .normalize();
    return { pos: c.clone().addScaledVector(d, ZONE_DIST[name] ?? 2.7), target: c };
  };

  // Bottom-up order inside each phase: the height is split into bands and the lowest band is built
  // first. Within a band, every piece lands next to something already built (the nearest one).
  const BANDS = 6;
  const built = [];
  const ordered = [];
  phases.forEach((_, phaseIdx) => {
    const remaining = queue.filter((it) => it.phaseIdx === phaseIdx);
    if (!remaining.length) return;
    const ys = remaining.map((it) => it.info.center.y);
    const yMin = Math.min(...ys);
    const yRange = Math.max(1e-6, Math.max(...ys) - yMin);
    remaining.forEach((it) => {
      it.layer = Math.min(BANDS - 1, Math.floor(((it.info.center.y - yMin) / yRange) * BANDS));
    });
    while (remaining.length) {
      let bestI = 0;
      let bestL = Infinity;
      let bestD = Infinity;
      remaining.forEach((it, i) => {
        let d;
        if (built.length === 0) {
          d = it.info.center.y; // the very first piece: the lowest one
        } else {
          d = Infinity;
          for (const b of built) {
            const dd = it.info.center.distanceToSquared(b.info.center);
            if (dd < d) d = dd;
          }
        }
        if (it.layer < bestL || (it.layer === bestL && d < bestD)) {
          bestL = it.layer;
          bestD = d;
          bestI = i;
        }
      });
      const [pick] = remaining.splice(bestI, 1);
      built.push(pick);
      ordered.push(pick);
    }
  });
  queue.splice(0, queue.length, ...ordered);

  // Big pieces first. Fasteners: phase by phase, then region by region (ZONE_ORDER), then from the
  // bottom of each region upward, then around the cabin. A region is finished before the next starts.
  for (const it of queue) {
    // floor fasteners (Floor_*) are the bottom region, even when they sit right at the floor edge
    it.region = it.info.size < SMALL && /^floor/i.test(it.info.m.name) ? 'bottom' : zoneOf(it.info.center);
    it.zr = ZONE_ORDER.indexOf(it.region);
    it.ang = Math.atan2(it.info.center.x - cabinC.x, it.info.center.z - cabinC.z);
    if (it.info.size < SMALL) it.layer = it.zr; // grouping key: a unit never mixes regions
  }
  // Only the fasteners under the cabin are animated. The others are already installed with the cabin.
  const staticPops = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].info.size < SMALL && queue[i].zr !== 0) staticPops.unshift(queue.splice(i, 1)[0]);
  }
  queue.sort((x, y) => {
    const xs = x.info.size < SMALL ? 1 : 0;
    const ys = y.info.size < SMALL ? 1 : 0;
    if (xs !== ys) return xs - ys;
    if (!xs) return x.phaseIdx - y.phaseIdx;
    return (
      x.phaseIdx - y.phaseIdx ||
      x.zr - y.zr ||
      x.info.center.y - y.info.center.y ||
      x.ang - y.ang
    );
  });

  // 2. Units. Identical pieces (same name stem, size and phase), up to GROUP at once, land together:
  // each one still flies in from its own side. Lone fasteners are gathered into small groups.
  const stemOf = (name) => normalizeNodeName(name).replace(/[._\-]?\d+$/, '').replace(/[._\-]+$/, '');
  const keyOf = (it) => `${stemOf(it.info.m.name)}|${it.phaseIdx}|${it.layer}|${Math.round(it.info.size * 20)}`;
  const taken = new Set();
  const units = [];
  for (const it of queue) {
    if (taken.has(it)) continue;
    const key = keyOf(it);
    const unit = [it];
    taken.add(it);
    for (const other of queue) {
      if (unit.length >= GROUP) break;
      if (!taken.has(other) && keyOf(other) === key) {
        unit.push(other);
        taken.add(other);
      }
    }
    units.push(unit);
  }
  const merged = [];
  let pending = null;
  for (const u of units) {
    if (u.length === 1 && u[0].info.size < SMALL) {
      const same = pending && pending[0].phaseIdx === u[0].phaseIdx && pending[0].layer === u[0].layer;
      if (same && pending.length < GROUP) pending.push(...u);
      else {
        pending = [...u];
        merged.push(pending);
      }
    } else {
      merged.push(u);
    }
  }

  // The last joint: the big yellow piece at the front, lowest one. It seats after everything else.
  let lastItem = null;
  for (const it of queue) {
    const c = it.info.center;
    if (!it.info.m.userData.yellow || it.info.size < SMALL || it.phase.camera === 'fixed' || c.z <= cabinC.z) continue;
    if (!lastItem || c.y < lastItem.info.center.y) lastItem = it;
  }
  if (lastItem) {
    for (const u of merged) {
      const k = u.indexOf(lastItem);
      if (k >= 0) u.splice(k, 1);
    }
    for (let i = merged.length - 1; i >= 0; i--) if (merged[i].length === 0) merged.splice(i, 1);
    merged.push([lastItem]);
  }

  // One global timeline: one slot per unit.
  const T0 = Math.min(...phases.map((p) => p.range[0]));
  const T1 = Math.max(...phases.map((p) => p.range[1]));
  const SLOTS = Math.max(1, merged.length);
  const slot = (T1 - T0) / SLOTS;
  const slotOf = new Map();
  const unitSize = new Map();
  const memberOf = new Map();
  const unitOf = new Map();
  const recOf = new Map();
  merged.forEach((u, si) => u.forEach((it, k) => {
    unitOf.set(it, u);
    slotOf.set(it, si);
    unitSize.set(it, u.length);
    memberOf.set(it, k);
  }));
  const N = Math.max(1, queue.length);

  const records = [];
  const phaseInfo = phases.map((p) => ({ ...p, count: 0, pops: 0 }));

  queue.forEach((item, idx) => {
    const { phase, phaseIdx, info } = item;
    const { m } = info;
    const isPop = info.size < SMALL;
    phaseInfo[phaseIdx].count++;
    if (isPop) phaseInfo[phaseIdx].pops++;

    const slotIdx = slotOf.get(item);
    const start = T0 + slotIdx * slot;
    const share = isPop ? POP_FLIGHT : info.size < 0.5 ? MID_FLIGHT : FLIGHT;
    // the last piece lands slowly and softly: a cinematic finish after the laser sign
    const dur = slot * (slotIdx === merged.length - 1 ? 0.9 : share);

    // Approach direction in outer space: from the side this piece is assigned to.
    // Fasteners travel as a train: they fly along one lane on the cabin's outer side, shared by the
    // whole unit, one behind another. The camera rides the train and passes each one as it lands.
    let approach;
    let trainTrack = null;
    let camDir = null;
    let trainOff = 0;
    let trainW = 0;
    if (isPop) {
      const u = unitOf.get(item);
      const cen = new THREE.Vector3();
      for (const x of u) cen.add(x.info.center);
      cen.divideScalar(u.length);
      const rad = cen.sub(cabinC);
      rad.y = 0;
      if (rad.lengthSq() < 1e-6) rad.set(0, 0, 1);
      rad.normalize();
      const sign = slotIdx % 2 ? 1 : -1;
      approach = new THREE.Vector3(0, 1, 0).cross(rad).normalize().multiplyScalar(sign);
      camDir = rad.clone();
      const k = memberOf.get(item) ?? 0;
      trainOff = k * TRAIN_GAP * slot;
      trainW = TRAIN_FLIGHT * slot;
    } else if (unitSize.get(item) > 1) {
      const rad = info.center.clone().sub(cabinC);
      if (rad.lengthSq() < 1e-6) rad.set(0, 1, 0);
      approach = rad.normalize().add(new THREE.Vector3(0, 0.3, 0)).normalize();
    } else if (isPop) {
      approach = new THREE.Vector3(0, 1, 0);
    } else if (phase.dir === 'above') {
      approach = new THREE.Vector3((Math.random() - 0.5) * 0.4, 1, (Math.random() - 0.5) * 0.4).normalize();
    } else {
      const sideIdx = (idx * 3 + phaseIdx * 2) % SIDES.length;
      approach = SIDES[sideIdx].clone().normalize().add(
        new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.25),
      ).normalize();
    }
    // the last piece comes in from the left, in one soft slow glide
    if (item === lastItem) approach = new THREE.Vector3(-1, 0.12, 0).normalize();
    const reach = isPop ? TRAIN_REACH : 1.3 + Math.random() * 0.6;
    const dirOuter = approach.clone().multiplyScalar(reach);

    // Convert outer-space vectors into the mesh's parent-local space.
    const toParent = new THREE.Matrix4()
      .copy(m.parent.matrixWorld)
      .invert()
      .multiply(outer.matrixWorld);
    const origin = zero.clone().applyMatrix4(toParent);
    const dir = dirOuter.clone().applyMatrix4(toParent).sub(origin);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix4(toParent).sub(origin).normalize();

    // Contact point: on the face of the piece that meets the incoming direction.
    const contact = info.center.clone().addScaledVector(approach, -info.size * 0.3);

    // Camera: big joints pull back, medium pieces orbit, yellow pieces are followed, fasteners get none.
    // Camera moves are zone-based (see zoneOf); floor and wall steps keep the camera still.
    // A random selection of medium/big pieces also gets its own focus (zoom in or pull back).
    let focusMode = null;
    if (!isPop && phase.camera !== 'fixed' && Math.random() < FOCUS_CHANCE) {
      focusMode = m.userData.yellow ? 'follow' : (phase.focus ?? (info.size >= (phase.focusMin ?? 0.45) ? 'wide' : 'orbit'));
    }
    // fasteners do not move the camera zone: a train stays in the step's main position
    const zone = phase.camera === 'fixed' || item === lastItem ? null : isPop ? item.region : zoneOf(info.center);

    // Glow while in the air: give each mesh its own material so only this piece lights up.
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const glowMats = mats.filter((mt) => mt && mt.emissive).map((mt) => {
      const own = mt.clone();
      mt.emissive && own.emissive.copy(mt.emissive);
      return own;
    });
    if (glowMats.length) {
      if (Array.isArray(m.material)) m.material = mats.map((mt, i) => (mt && mt.emissive ? glowMats.shift() : mt));
      else m.material = glowMats[0];
    }
    const glowTargets = (Array.isArray(m.material) ? m.material : [m.material]).filter((mt) => mt && mt.emissive);

    records.push({
      m,
      rest: m.position.clone(),
      restScale: m.scale.clone(),
      restQuat: m.quaternion.clone(),
      outerCenter: info.center.clone(),
      spin: !isPop && info.size >= SMALL ? (idx % 2 ? 1 : -1) * (1.1 + Math.random() * 0.4) : 0,
      dir,
      up,
      contact,
      approach,
      size: info.size,
      start,
      dur,
      slotLen: slot,
      groupK: memberOf.get(item) ?? 0,
      groupN: unitSize.get(item) ?? 1,
      weight: isPop ? TRAIN_WEIGHT : info.size < 0.5 ? SMALL_WEIGHT : 1,
      motion: isPop ? 'train' : 'fly',
      trainOff,
      trainW,
      trainTrack,
      camDir,
      trainLast: isPop && memberOf.get(item) === unitSize.get(item) - 1,
      fired: false,
      focused: false,
      focusMode: trainTrack ? 'follow' : focusMode,
      zone,
      focusWorld: outer.localToWorld(contact.clone()),
      focusSize: info.size,
      impact: item === lastItem ? { dust: 2.2, sparks: 1.8, shake: 1.4, heavy: true } : phase.impact ?? {}, // strong, visible landing
      isLast: item === lastItem,
      bounce: item === lastItem ? 0.09 : Math.min(0.05, 0.01 + info.size * 0.025), // the last piece rebounds clearly on landing
      glowTargets,
      liveT: 0,
    });

    recOf.set(item, records[records.length - 1]);
    m.visible = false;
  });

  // Fasteners outside the bottom region are not animated. Each one is hidden until the nearest
  // big piece it belongs to has landed, then it simply shows in place.
  const bigRecs = records.filter((r) => r.motion === 'fly');
  const statics = staticPops.map((it) => {
    let best = null;
    let bd = Infinity;
    for (const r of bigRecs) {
      const d = r.outerCenter.distanceToSquared(it.info.center);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    it.info.m.visible = false;
    return { m: it.info.m, at: best ? best.start + best.dur : 0 };
  });

  // Scroll map: the scroll distance per unit of progress is larger over medium and small pieces,
  // so their landings are slower and softer. toScroll / toProgress convert between the two.
  const GRID = 2000;
  const w = new Float64Array(GRID).fill(1);
  for (const rec of records) {
    const a = Math.max(0, Math.floor(rec.start * GRID));
    const b = Math.min(GRID, Math.ceil((rec.start + rec.slotLen) * GRID));
    for (let i = a; i < b; i++) w[i] = rec.weight;
  }
  const cum = new Float64Array(GRID + 1);
  for (let i = 0; i < GRID; i++) cum[i + 1] = cum[i] + w[i];
  const total = cum[GRID];
  const sAt = (i) => cum[i] / total;
  const toScroll = (p) => {
    const x = Math.min(1, Math.max(0, p)) * GRID;
    const i = Math.min(GRID - 1, Math.floor(x));
    return sAt(i) + (sAt(i + 1) - sAt(i)) * (x - i);
  };
  const toProgress = (s) => {
    const target = Math.min(1, Math.max(0, s)) * total;
    let lo = 0;
    let hi = GRID;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const segW = cum[hi] - cum[lo] || 1;
    return (lo + (target - cum[lo]) / segW) / GRID;
  };
  // Auto-scroll stops: where each piece (or fastener group) is in the air.
  const stops = [
    ...new Set(records.map((r) => Math.round((r.start + STOP_AT * r.dur) * 1e5) / 1e5)),
  ].sort((a, b) => a - b);

  function emitImpact(rec) {
    const sizeFactor = THREE.MathUtils.clamp(rec.size / 0.5, 0.25, 1.5);
    const isPop = rec.motion === 'train';
    const imp = rec.impact;
    if (imp.heavy) fx.bigShake = 1; // the last piece's landing shakes the camera
    const a = rec.approach;
    fx.emit({
      x: rec.contact.x,
      y: rec.contact.y,
      z: rec.contact.z,
      nx: a.x,
      ny: a.y,
      nz: a.z,
      dust: isPop ? 0.15 : (imp.dust ?? 0) * sizeFactor,
      sparks: isPop ? (imp.sparks ?? 1) : (imp.sparks ?? 0) * (0.5 + sizeFactor * 0.5),
      // big pieces keep the full shake; small pieces shake less, scaled by their size
      shake: isPop ? 0.01 : (imp.shake ?? 0) * (rec.size >= 0.5 ? sizeFactor : THREE.MathUtils.clamp(rec.size / 0.5, 0.1, 1)),
    });
  }

  let lastZone = null;
  let lastViewSet = false; // the camera holds on the last piece from its flight to its landing
  // camera view for the last piece: from the front-left, holding it through its flight and landing
  function lastPieceZone() {
    const r = records.find((x) => x.isLast);
    if (!r) return null;
    const c = r.outerCenter;
    const off = new THREE.Vector3(-1, 0.25, 0.9).normalize().multiplyScalar(2.2);
    return { pos: outer.localToWorld(c.clone().add(off)), target: outer.localToWorld(c.clone()) };
  }
  let popCam = null; // the fastener region the camera is holding
  let laserLi = -1; // the letter the camera is following while it is cut

  // Fastener regions: the camera goes to a region's fixed view when its first fastener starts,
  // holds it until the last one of that region lands, then returns to the main path.
  const regions = new Map(); // zone -> [from, to] in progress units
  for (const rec of records) {
    if (rec.motion !== 'train') continue;
    const r = regions.get(rec.zone) ?? [Infinity, -Infinity];
    r[0] = Math.min(r[0], rec.start);
    r[1] = Math.max(r[1], rec.start + rec.slotLen);
    regions.set(rec.zone, r);
  }
  const activeRegion = (p) => {
    for (const [z, [a, b]] of regions) if (p >= a - 1e-6 && p < b) return z;
    return null;
  };

  function update(progress, dt = 0, idle = false) {
    laser?.update(progress, dt);
    for (const st of statics) st.m.visible = progress >= st.at;
    let zoneNow = null;
    for (const rec of records) {
      // One timeline for every scroll speed: auto-scroll and manual scroll place each piece identically,
      // so switching between them never moves a group of pieces at once.
      const t = rec.motion === 'train'
        ? clamp01((progress - rec.start - rec.trainOff) / rec.trainW)
        : clamp01((progress - rec.start) / rec.dur);
      if (rec.zone && t > 0 && rec.motion !== 'train') zoneNow = rec.zone; // the zone of the latest big piece that has started
      const m = rec.m;
      rec.liveT = t;
      const track = () => (rec.liveT >= 1 ? null : m.getWorldPosition(new THREE.Vector3()));

      // The camera starts with the piece as it appears and tracks it until it lands.
      // Per-piece focus only during manual scrolling; the auto-scroll keeps the zone view.
      if (rec.focusMode && !rec.focused && t > 0 && (rec.trainTrack ? fx.autoScroll : !fx.autoScroll)) {
        rec.focused = true;
        if (rec.trainTrack) fx.focusTrain?.(rec.trainTrack, rec.size);
        else if (rec.focusMode === 'follow') fx.focusFollow?.(track, rec.approach, rec.size);
        else fx.focusOn?.(rec.focusWorld, rec.focusSize, rec.approach, rec.focusMode, track);
      }

      const flying = (rec.motion === 'fly' || rec.motion === 'train') && t > 0 && t < 1;
      if (rec.isLast && t > 0 && !lastViewSet) {
        lastViewSet = true;
        const c = rec.outerCenter;
        const off = new THREE.Vector3(-1, 0.25, 0.9).normalize().multiplyScalar(2.2);
        fx.setZone({
          pos: outer.localToWorld(c.clone().add(off)),
          target: outer.localToWorld(c.clone()),
        });
      }

      // Glow while the piece is in the air, fading out as it lands.
      if (rec.glowTargets.length) {
        const g = flying ? Math.sin(Math.PI * t) * 0.35 : 0;
        for (const mt of rec.glowTargets) {
          mt.emissive.copy(GLOW);
          mt.emissiveIntensity = g;
        }
      }

      if (rec.motion === 'train') {
        // a fastener: appears, then flies along the train lane into its place
        m.visible = t > 0;
        m.scale.copy(rec.restScale).multiplyScalar(Math.max(0.0001, Math.min(1, t * 5)));
        m.position.copy(rec.rest).addScaledVector(rec.dir, 1 - easeInOut(t));
      } else if (rec.motion === 'pop' || rec.motion === 'train') {
        m.visible = t > 0;
        const k = Math.max(0.0001, t * t * (3 - 2 * t)); // smoothstep: soft pop-in
        m.scale.copy(rec.restScale).multiplyScalar(k);
      } else {
        m.visible = t > 0;
        const f = 1 - easeInOut(t); // eased path: slow start, gentle middle, slow landing
        m.position.copy(rec.rest).addScaledVector(rec.dir, f);
        // big pieces turn on their own axis while flying in
        const q = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rec.spin * f);
        m.quaternion.copy(rec.restQuat).premultiply(q);
        if (t >= 0.95) {
          // small rebound after contact: the piece settles instead of stopping dead
          const u = clamp01((t - 0.95) / 0.05);
          m.position.addScaledVector(rec.up, Math.sin(Math.PI * u) * rec.bounce * (1 - u) * 2);
        }
      }

      if (t >= 0.95) {
        if (!rec.fired) {
          rec.fired = true;
          emitImpact(rec);
        }
      } else {
        rec.fired = false; // re-triggers when scrolling back and forth
        rec.focused = rec.focused && t > 0;
      }
    }
    const li = laser ? laser.activeLetter(progress) : -1;
    if (li >= 0) {
      // the camera moves in front of each letter as the laser reaches it
      if (li !== laserLi) {
        laserLi = li;
        fx.setZone(laser.viewFor(li));
      }
    } else {
      if (laserLi >= 0) {
        laserLi = -1;
        // the word is done: the camera moves straight to the last piece, so it does not pull back first
        fx.setZone(lastPieceZone());
        lastViewSet = true;
      }
    const pz = activeRegion(progress);
    if (pz) {
      if (popCam !== pz) {
        popCam = pz;
        fx.setZone(zoneView(pz)); // fixed view for this region; the fasteners do not move the camera
      }
    } else {
      if (popCam) {
        popCam = null;
        fx.setZone(null); // region finished: back to the main position
      }
      if (zoneNow && zoneNow !== lastZone) {
        lastZone = zoneNow;
        fx.setZone(zoneView(zoneNow));
      }
    }
    }
  }

  // The CAMAC sign is etched on the front face just before the last joint.
  let laser = null;
  let laserEnd = 0; // progress where the laser sign is finished
  if (lastItem) {
    // The host panel: the grey front panel beside the door opening (the one marked for the sign).
    const hostName = normalizeNodeName(LASER_HOST);
    let host = queue.find((it) => normalizeNodeName(it.info.m.name) === hostName) ?? null;
    if (!host) {
      // fallback: the nearest non-yellow big piece on the front side
      const lc = lastItem.info.center;
      let hostD = Infinity;
      for (const it of queue) {
        if (it === lastItem || it.info.size < 0.5 || it.info.m.userData.yellow || it.info.center.z <= cabinC.z) continue;
        const d = it.info.center.distanceTo(lc);
        if (d < hostD) {
          hostD = d;
          host = it;
        }
      }
    }
    if (host) {
      const b = host.info.outerBox;
      const lastStart = T0 + (merged.length - 1) * slot;
      laser = createLaserSign({
        fx,
        toWorld: (v) => outer.localToWorld(v.clone()),
        panel: {
          cx: (b.min.x + b.max.x) / 2,
          cy: (b.min.y + b.max.y) / 2,
          zFace: b.max.z,
          width: b.max.x - b.min.x,
          height: b.max.y - b.min.y,
        },
        windowStart: lastStart - slot * 1.55, // slow, cinematic cut
        windowEnd: lastStart - slot * 0.05,
      });
      laserEnd = lastStart - slot * 0.05;
      outer.add(laser.group);
    }
  }

  // progress where the whole assembly (laser sign included) is finished, and that point's share of the scroll track
  const pieceEnd = Math.max(...records.map((r) => (r.motion === 'train' ? r.start + r.trainOff + r.trainW : r.start + r.dur)));
  // a short pause after the last landing: the camera holds while the piece settles, then frames the cabin
  const completeAt = Math.min(1, Math.max(pieceEnd + slot * 0.3, laserEnd));
  const share = toScroll(completeAt);
  return { update, phases: phaseInfo, count: records.length, scrollMap: { toScroll, toProgress }, stops, completeAt, share };
}

/** Index of the phase that is active at `progress`. */
export function chapterIndex(progress, steps) {
  let idx = 0;
  steps.forEach((st, i) => {
    if (progress >= st.range[0]) idx = i;
  });
  return idx;
}
