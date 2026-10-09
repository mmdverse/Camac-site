/**
 * CAMAC — cabin catalogue and cinematic assembly script (data-driven).
 *
 * - cabins[]     : one entry per cabin model (GLB path, interactive parts, specs)
 * - assembly[]   : the assembly sequence. Each step targets GLB nodes by EXACT name.
 *                  range = [start, end] on the 0..1 scroll progress of the sequence.
 * - cameraPath[] : cinematic camera keyframes (pos/target relative to model, units of
 *                  the normalised model: largest dimension = 2).
 *
 * NOTE: copy, labels and specs marked `placeholder` are temporary.
 */

export const brand = {
  name: 'CAMAC',
  tagline: 'کابین، لحظه‌ به‌ لحظه ساخته می‌شود',
  placeholder: true,
};

/**
 * Cinematic assembly script. Each phase animates EVERY mesh under its target groups,
 * one by one, in the given order (order: bottomUp | topDown | centerOut).
 *  dir        : 'above' (drops from the sky) | 'around' (each piece from its own side)
 *  camera     : 'fixed' keeps the camera still for this step (the model turns instead)
 *  focus      : 'wide' (camera pulls back and views the joint from the piece's side) | 'orbit' (camera circles the joint)
 *  smallMax   : meshes smaller than this (model units) punch in with a pop + sparks
 *  impact     : dust / sparks / shake intensity per contact (scaled by mesh size)
 */
export const assemblySteps = [
  {
    id: 'base',
    camera: 'fixed', // the camera stays still; only the model turns
    label: 'پایه کابین',
    targets: ['کف'],
    dir: 'above',
    focus: 'wide',
    order: 'centerOut',
    range: [0.03, 0.2],
    impact: { dust: 1.0, sparks: 0.5, shake: 0.55 },
  },
  {
    id: 'walls',
    camera: 'fixed', // the camera stays still; only the model turns
    label: 'بدنه‌ها',
    targets: ['بدنه پشت', 'بدنه بغل'],
    dir: 'around',
    focus: 'wide', // large panels: the camera pulls back so the whole connection is visible
    order: 'ring', // left wall, right wall, back wall, ... one piece at a time
    range: [0.2, 0.4],
    impact: { dust: 0.8, sparks: 0.7, shake: 0.6 },
  },
  {
    id: 'front',
    label: 'جلوبندی',
    targets: ['جلوبندی'],
    dir: 'around',
    focus: 'wide',
    order: 'bottomUp',
    range: [0.4, 0.55],
    impact: { dust: 0.7, sparks: 0.9, shake: 0.7 },
  },
  {
    id: 'roof',
    label: 'سقف',
    targets: ['سقف'],
    dir: 'above',
    focus: 'wide',
    order: 'topDown',
    range: [0.55, 0.74],
    impact: { dust: 1.2, sparks: 1.0, shake: 1.0 },
  },
  {
    id: 'yoke',
    label: 'یوک‌بندی و قفل‌ها',
    targets: ['مدل یوک بندی'],
    dir: 'around',
    focus: 'orbit', // small fasteners: the camera circles the joint
    order: 'topDown',
    range: [0.74, 0.9],
    impact: { dust: 0.9, sparks: 1.0, shake: 0.9 },
  },
];

/**
 * Camera keyframes over the whole sequence + finale.
 * The camera pushes in on fasteners, dollies around the walls, and pulls back
 * for the final hero frame.
 */
export const cameraPath = [
  { progress: 0.0, pos: [0.7, 1.1, 4.6], target: [0, -0.3, 0], fov: 36 },
  { progress: 0.14, pos: [1.9, 0.9, 2.7], target: [0, -0.4, 0], fov: 32 },
  { progress: 0.26, pos: [-1.9, 0.5, 2.2], target: [0, -0.1, 0], fov: 30 },
  { progress: 0.37, pos: [2.2, 0.5, 1.2], target: [0, 0.0, 0], fov: 30 },
  { progress: 0.47, pos: [0.0, 0.3, 2.7], target: [0, 0.0, 0], fov: 32 },
  { progress: 0.56, pos: [0.4, 2.7, 1.5], target: [0, 0.9, 0], fov: 40 },
  { progress: 0.66, pos: [1.0, 1.2, 0.95], target: [0.8, 1.0, 0.2], fov: 24 },
  { progress: 0.76, pos: [-1.7, 0.6, 2.2], target: [0, 0.1, 0], fov: 32 },
  { progress: 0.86, pos: [0.4, -0.2, 1.3], target: [0, -0.2, 0], fov: 26 },
  { progress: 0.94, pos: [0.35, 0.3, 3.4], target: [0, 0, 0], fov: 30 },
  { progress: 1.0, pos: [0.35, 0.3, 3.4], target: [0, 0, 0], fov: 30 },
];

export const cabins = [
  {
    id: 'pro-v6',
    name: 'Cabin Pro V6.3',
    // Quality tiers: desktop textures capped at 2048px, mobile at 1024px (GPU memory).
    model: {
      desktop: '/models/cabin-pro-v6.desktop.glb',
      mobile: '/models/cabin-pro-v6.mobile.glb',
    },
    assembly: assemblySteps,
    cameraPath,
    // Exact GLB group names that become interactive after assembly.
    parts: [
      { id: 'floor', match: 'کف', label: 'کف', title: 'کف کابین', description: 'متن نمونه: کف با روکش مقاوم و ساختار تقویت‌شده.', placeholder: true },
      { id: 'roof', match: 'سقف', label: 'سقف', title: 'سقف کابین', description: 'متن نمونه: سقف شامل نورپردازی، تهویه و ساختار اتصال.', placeholder: true },
      { id: 'side-walls', match: 'بدنه بغل', label: 'دیواره‌ها', title: 'دیواره‌های کناری', description: 'متن نمونه: پوشش دیواره‌ها با پنل‌های هم‌تراز.', placeholder: true },
      { id: 'back-wall', match: 'بدنه پشت', label: 'دیواره پشت', title: 'دیواره پشت', description: 'متن نمونه: دیواره‌ی پشتی با طراحی یکپارچه.', placeholder: true },
      { id: 'front-panels', match: 'جلوبندی', label: 'جلوبندی و درب‌ها', title: 'جلوبندی', description: 'متن نمونه: آستانه، پنل‌های جانبی و قاب درب.', placeholder: true },
      { id: 'yoke', match: 'مدل یوک بندی', label: 'سیستم یوک', title: 'سیستم یوک‌بندی', description: 'متن نمونه: مجموعه‌ی یوک، پاراشوت و بافرها.', placeholder: true },
    ],
    specs: [
      { label: 'ابعاد داخلی', value: '—', placeholder: true },
      { label: 'ظرفیت', value: '—', placeholder: true },
      { label: 'جنس روکش', value: '—', placeholder: true },
      { label: 'سرعت', value: '—', placeholder: true },
    ],
  },
];

export function getCabin(id) {
  return cabins.find((c) => c.id === id) ?? cabins[0];
}
