/**
 * Tiny external store shared by the 3D scene (R3F) and the DOM UI.
 * Kept outside React so per-frame updates (scroll progress) never re-render the tree.
 */
const listeners = new Set();

export const store = {
  progress: 0,        // 0..1 scroll progress across the experience
  hovered: null,      // part id under the pointer
  selected: null,     // part id focused by click
  assembled: false,   // true once the whole track, including the showcase, has played (enables rotate)
  showU: 0,           // 0..1 progress of the final showcase (the cabin turns from several angles)
  set(patch) {
    Object.assign(this, patch);
    listeners.forEach((fn) => fn());
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot() {
    return this;
  },
};
