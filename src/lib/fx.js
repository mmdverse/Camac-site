import * as THREE from 'three';

/**
 * Impact effects bus. Assembly code emits events here; the Impacts component
 * consumes them every frame, and the camera rig reads `focus`.
 * Kept outside React so emitting never re-renders.
 */
export const fx = {
  shake: 0,
  queue: [],
  idle: false, // true while scrolling has stopped (set by the camera rig)
  camPos: null, // camera position in world space (set by the camera rig)
  view: { active: false, yaw: 0, pitch: 0 }, // cabin turn (kept inactive)
  autoScroll: false, // true while the page is scrolling by itself (no per-piece focus then)
  zone: null, // sequence camera zone: { pos, target } in world space, set once per zone
  focus: null, // { pos: Vector3 (world), camPos: Vector3 (world), size, t, hold }
  setZone(z) {
    this.zone = z;
  },
  emit(event) {
    this.queue.push(event);
    if (event.shake) this.addShake(event.shake);
  },
  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
  },
  // Follow focus: the camera tracks a moving piece (track() returns its world position,
  // or null once it has landed). Used for yellow pieces.
  focusFollow(track, approachOuter, size, sweep = 0) {
    const dir = approachOuter.clone().normalize().add(new THREE.Vector3(0, 0.25, 0)).normalize();
    this.focus = {
      mode: 'follow',
      sweep, // how far the camera swings around the subject (radians), so it sees it from several angles
      track,
      pos: track() ?? new THREE.Vector3(),
      dir,
      dist: 1.7,
      angle0: 0,
      size,
      t: 0,
      hold: 0,
    };
  },

  // Fastener group focus: the camera keeps its position and only swings a little toward the group.
  focusTrain(track, size) {
    this.focus = {
      mode: 'train',
      track,
      pos: track() ?? new THREE.Vector3(),
      dir: new THREE.Vector3(0, 1, 0),
      dist: 0,
      angle0: 0,
      size,
      t: 0,
      hold: 1.2,
    };
  },

  // Camera focus. The camera goes to the side the piece comes from, so a piece at the back
  // is viewed from behind. 'wide' pulls back to show the whole joint; 'orbit' circles it.
  // A cooldown stops two focuses from stacking.
  focusOn(worldPos, size, approachOuter, mode = 'orbit', track = null) {
    const dir = approachOuter.clone().normalize().add(new THREE.Vector3(0, 0.25, 0)).normalize();
    const dist =
      mode === 'wide' ? THREE.MathUtils.clamp(2.2 + size * 0.5, 2.2, 3.0) : 1.2;
    this.focus = {
      mode,
      track,
      pos: (track && track()) || worldPos.clone(),
      dir,
      dist,
      angle0: Math.atan2(dir.x, dir.z),
      size,
      t: 0,
      hold: mode === 'wide' ? 1.8 : 1.4,
    };
  },
};
