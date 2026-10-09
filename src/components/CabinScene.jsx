import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ContactShadows, useGLTF } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import CabinModel from './CabinModel';
import { store } from '../lib/store';
import { fx } from '../lib/fx';
import { sampleCameraPath } from '../lib/cameraMath';

// Palette: warm stone-grey stage, white light, safety-yellow accents.
const BG = '#cfccc4';
const GROUND = '#b7b3a9';
const ORIGIN = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

export default function CabinScene({ cabin, onModelReady }) {
  const [bounds, setBounds] = useState(null);
  const partBoxesRef = useRef(new Map());

  const handleReady = useCallback(
    ({ bounds: b, partBoxes }) => {
      partBoxesRef.current = partBoxes;
      setBounds(b);
      onModelReady?.();
    },
    [onModelReady],
  );

  const groundY = bounds ? bounds.min.y : -1;

  return (
    <Canvas
      shadows
      dpr={isMobile ? [1, 1.5] : [1, 2]}
      resize={{ debounce: 250, scroll: false }} // the mobile address bar resizes the page: do not redraw on every step
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
        outputColorSpace: THREE.SRGBColorSpace,
        powerPreference: 'high-performance',
      }}
      camera={{ position: [0.7, 1.1, 4.6], fov: 36, near: 0.01, far: 60 }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color(BG);
        scene.fog = new THREE.Fog(BG, 4.5, 11);
      }}
    >
      <Environment />
      <Lights />
      <Suspense fallback={null}>
        <StageSet />
      </Suspense>
      <Suspense fallback={null}>
        <CabinModel cabin={cabin} onReady={handleReady} />
      </Suspense>
      {bounds && (
        <ContactShadows
          position={[0, groundY + 0.002, 0]}
          opacity={0.5}
          scale={7}
          blur={2.6}
          far={3}
          resolution={512}
          color="#2a2620"
        />
      )}
      <ScanRing />
      <CameraRig cabin={cabin} partBoxesRef={partBoxesRef} />
      <OrbitRig />
      <Post />
    </Canvas>
  );
}

/** Image-based lighting from a neutral studio room. Gives PBR materials real reflections. */
function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.45;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

/**
 * Empty studio built in Blender (tools/blender/build_stage.py → public/models/stage.glb):
 * curved stone-grey backdrop, satin floor, yellow LED seam, white light fins, columns.
 */
function StageSet() {
  const { scene } = useGLTF('/models/stage.glb');
  // The yellow LED strips get an animated shader: light pulses travel along the strip.
  const ledMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform float uTime; varying vec3 vPos;
          void main(){
            float wave = 0.5 + 0.5 * sin(vPos.x * 0.9 - uTime * 2.4);
            float pulse = pow(wave, 6.0);
            vec3 base = vec3(1.0, 0.72, 0.08);
            gl_FragColor = vec4(base * (0.9 + 1.6 * pulse), 1.0);
          }`,
      }),
    [],
  );
  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh && o.name.startsWith('LED_Seam')) o.material = ledMaterial;
      // The backdrop sweep is front-side only: its floor faces up and its walls face into the room,
      // so from below the floor no longer hides the cabin.
      if (o.isMesh && o.name === 'Cyclorama') {
        o.material = o.material.clone();
        o.material.side = THREE.FrontSide;
      }
    });
  }, [scene, ledMaterial]);
  useFrame((state) => {
    ledMaterial.uniforms.uTime.value = state.clock.elapsedTime;
  });
  return <primitive object={scene} receiveShadow />;
}

/**
 * Scan ring from the reference: a thin yellow laser ring that climbs the cabin while
 * the pieces assemble, and fades out at the end. Hidden at the start (empty environment).
 */
function ScanRing() {
  const ref = useRef();
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform float uOpacity; varying vec3 vPos;
          void main(){
            // ring spans radius 1.38..1.44: map to -1..1 across its width
            float r = (length(vPos.xy) - 1.41) / 0.03;
            float core = exp(-pow(r * 9.0, 2.0));
            float halo = exp(-pow(r * 2.6, 2.0)) * 0.25;
            vec3 c = mix(vec3(1.0, 0.74, 0.12), vec3(1.0, 0.98, 0.9), core);
            gl_FragColor = vec4(c * (core + halo) * uOpacity, 1.0);
          }`,
      }),
    [],
  );

  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const p = store.progress;
    const active = p > 0.02 && p < 0.97;
    const e = Math.min(1, Math.max(0, (p - 0.02) / 0.9));
    // Climbs from the floor to above the cabin, then eases out.
    mesh.position.y = THREE.MathUtils.lerp(-0.95, 1.25, e);
    const target = active ? 0.9 : 0;
    material.uniforms.uOpacity.value += (target - material.uniforms.uOpacity.value) * (1 - Math.exp(-dt * 8));
    mesh.visible = material.uniforms.uOpacity.value > 0.003;
  });

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} material={material} raycast={() => null}>
      <ringGeometry args={[1.38, 1.44, 96, 1]} />
    </mesh>
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={['#f4f1e8', '#8a857a', 0.3]} />
      <directionalLight
        position={[2.6, 4.2, 2.2]}
        intensity={1.25}
        color="#fff4dc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-camera-near={0.5}
        shadow-camera-far={14}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* warm yellow rim light from behind: separates the cabin from the grey stage */}
      <directionalLight position={[-3, 2.4, -2.5]} intensity={1.4} color="#ffc53a" />
    </>
  );
}

/**
 * Once the cabin is complete (and nothing is selected), the visitor can turn it: orbit controls take the camera.
 */
function OrbitRig() {
  const { camera, gl } = useThree();
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enablePan = false;
    c.enableZoom = false; // rotate only
    c.minPolarAngle = 0; // every angle, from above to below
    c.maxPolarAngle = Math.PI;
    c.target.set(0, 0, 0);
    c.enabled = false;
    // OrbitControls sets touch-action: none on the canvas, which blocks page scrolling on touch screens.
    // Keep vertical touch scrolling for the page; horizontal drags still rotate the cabin.
    gl.domElement.style.touchAction = 'pan-y';
    return c;
  }, [camera, gl]);
  useEffect(() => () => controls.dispose(), [controls]);
  useFrame(() => {
    const on = store.assembled;
    if (controls.enabled !== on) controls.enabled = on;
    if (on) controls.update();
  });
  return null;
}

/**
 * Cinematic camera. Path follows scroll progress; impacts add a decaying shake.
 * A click on a part (after assembly) focuses that part.
 */
function CameraRig({ cabin, partBoxesRef }) {
  const { camera, size } = useThree();
  const cur = useMemo(
    () => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 36, primed: false }),
    [],
  );
  const tmp = useMemo(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 36 }), []);
  const shakeOffset = useMemo(() => new THREE.Vector3(), []);
  // Idle hold: when scrolling stops, the camera stays where it is with a slow drift,
  // instead of returning to the scroll path.
  const hold = useMemo(() => ({ lastP: -1, idle: 0, pos: null, target: null, settled: false }), []);
  const finalTmp = useMemo(() => ({ pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 36 }), []);
  // Zone moves ease from where the camera was to the new zone over a few seconds (no hard cut).
  const zt = useMemo(
    () => ({ zone: null, from: new THREE.Vector3(), fromT: new THREE.Vector3(), t: 1 }),
    [],
  );

  useFrame((state, dt) => {
    sampleCameraPath(cabin.cameraPath, store.progress, ORIGIN, 1, tmp);
    // Portrait / narrow viewports: pull the camera back and widen the lens so the cabin stays in frame.
    const aspect = size.width / Math.max(1, size.height);
    const narrow = Math.min(1, Math.max(0, (1.1 - aspect) / 0.6)); // 0 at landscape, 1 at portrait
    const pull = 1 + narrow * 0.55;
    let wantPos = tmp.pos.clone().sub(ORIGIN).multiplyScalar(pull).add(ORIGIN);
    let wantTarget = tmp.target.clone();
    let wantFov = tmp.fov * (1 + narrow * 0.12);

    const now = store.progress;
    const moved = Math.abs(now - hold.lastP) > 1e-5;
    hold.lastP = now;
    hold.idle = moved ? 0 : hold.idle + dt;
    // A sequence zone (laser, last piece, fastener region) owns the camera; the idle drift only applies without one.
    if (hold.idle > 0.4 && !fx.zone && !fx.laserView && !store.assembled) {
      if (!hold.pos) {
        hold.pos = cur.pos.clone();
        hold.target = cur.target.clone();
      }
      const tt = state.clock.elapsedTime;
      const drift = new THREE.Vector3(
        Math.sin(tt * 0.25) * 0.04,
        Math.sin(tt * 0.19 + 1) * 0.02,
        Math.cos(tt * 0.21) * 0.04,
      );
      wantPos = hold.pos.clone().add(drift);
      wantTarget = hold.target.clone().add(drift.clone().multiplyScalar(0.5));
      wantFov = cur.fov;
    } else {
      hold.pos = null;
      hold.target = null;
    }

    // Sequence camera: one move per zone (set in assembly.js). The idle drift above takes precedence.
    const zoneMove = !!fx.zone && !store.assembled && !fx.laserView; // the laser's camera takes priority
    // The laser: the camera follows the cutting front (in world space) as the word is cut.
    const laserCam = fx.laserView ? fx.laserView(store.progress) : null;
    if (laserCam) {
      wantPos = laserCam.pos;
      wantTarget = laserCam.target;
      wantFov = tmp.fov * (1 + narrow * 0.12);
    }
    if (fx.zone !== zt.zone) {
      zt.zone = fx.zone;
      zt.from.copy(cur.pos);
      zt.fromT.copy(cur.target);
      zt.t = 0;
    }
    if (zoneMove) {
      zt.t = Math.min(1, zt.t + dt / 2.6);
      const e = zt.t * zt.t * zt.t * (zt.t * (zt.t * 6 - 15) + 10); // smootherstep: soft start and landing
      wantPos = zt.from.clone().lerp(fx.zone.pos, e);
      wantTarget = zt.fromT.clone().lerp(fx.zone.target, e);
      wantFov = tmp.fov * (1 + narrow * 0.12);
    }

    // Cinematic focus. 'wide': a big joint, the camera pulls back so the whole connection reads.
    // 'close': a small piece, the camera dollies in and orbits slowly around it.
    let focusW = 0;
    if (fx.focus) {
      const f = fx.focus;
      f.t += dt;
      if (f.track) {
        const p = f.track();
        if (p) f.pos.lerp(p, 1 - Math.exp(-dt * 3)); // smooth hand-off from one fastener to the next
        else if (f.endT === undefined) f.endT = f.t + 0.8; // landed: hold briefly, then release
      }
      const end = f.endT ?? f.hold;
      const inW = smoothStep(f.t / 1.0); // a focus eases in over a second: no cut
      const outW = 1 - smoothStep((f.t - end) / 1.4);
      focusW = Math.min(inW, Math.max(0, outW));
      if (f.t > end + 1.0) fx.focus = null;
      if (focusW > 0.001) {
        const u = Math.min(1, f.t / f.hold);
        let camP;
        let fov;
        if (f.mode === 'train') {
          // A fastener group: the camera stays where it is and only swings a little toward the group.
          const rel = wantPos.clone().sub(wantTarget);
          const toGroup = Math.atan2(f.pos.x - wantTarget.x, f.pos.z - wantTarget.z);
          const sw = THREE.MathUtils.clamp(toGroup - Math.atan2(rel.x, rel.z), -0.3, 0.3);
          rel.applyAxisAngle(UP, sw * focusW);
          wantPos = wantTarget.clone().add(rel);
          wantTarget.lerp(f.pos, focusW * 0.6);
          camP = null;
        } else if (f.mode === 'follow') {
          const swing = f.sweep ? Math.sin(f.t * 0.45) * f.sweep : 0;
          const dir = f.dir.clone().applyAxisAngle(UP, swing);
          camP = f.pos.clone().addScaledVector(dir, f.dist);
          camP.y += 0.1;
          fov = 32;
        } else if (f.mode === 'wide') {
          const dist = THREE.MathUtils.lerp(f.dist * 0.9, f.dist * 1.15, u);
          camP = f.pos.clone().addScaledVector(f.dir, dist);
          fov = 36;
        } else {
          const dir = f.dir.clone().applyAxisAngle(UP, f.angle0 + u * 0.35);
          camP = f.pos.clone().addScaledVector(dir, f.dist);
          camP.y += 0.1;
          fov = 30;
        }
        if (camP) {
          wantTarget.lerp(f.pos, focusW);
          wantPos.lerp(camP, focusW);
          wantFov += (fov - wantFov) * focusW;
        }
      }
    }


    if (!cur.primed) {
      cur.pos.copy(wantPos);
      cur.target.copy(wantTarget);
      cur.fov = wantFov;
      cur.primed = true;
    }
    // Completed model: the camera first settles on the final framing (not on the last close-up of the
    // laser), then the visitor can turn the cabin.
    if (store.assembled) {
      sampleCameraPath(cabin.cameraPath, 1, ORIGIN, 1, finalTmp);
      wantPos = finalTmp.pos.clone().sub(ORIGIN).multiplyScalar(pull).add(ORIGIN);
      wantTarget = finalTmp.target.clone();
      wantFov = finalTmp.fov * (1 + narrow * 0.12);
      if (!hold.settled && cur.pos.distanceTo(wantPos) < 0.03) hold.settled = true;
    } else {
      hold.settled = false;
    }
    fx.idle = hold.idle > 0.4;
    const k = zoneMove && !focus ? 1 : laserCam && !focus ? 1 - Math.exp(-dt * 2.6) : 1 - Math.exp(-dt * (focus ? 3.2 : focusW > 0.001 ? 6 : 5.5));
    cur.pos.lerp(wantPos, k);
    cur.target.lerp(wantTarget, k);
    cur.fov += (wantFov - cur.fov) * k;

    // Impact shake: a light, fast-decaying tremor. Kept subtle so the camera stays readable.
    fx.shake *= Math.exp(-dt * 6.5);
    fx.bigShake *= Math.exp(-dt * 1.3); // the last piece's landing: a clearly visible tremor
    const amp = Math.min(0.008, Math.pow(fx.shake, 1.4) * 0.008) + fx.bigShake * 0.06;
    const t = state.clock.elapsedTime;
    shakeOffset.set(
      (Math.sin(t * 61.0) * 0.6 + (Math.random() - 0.5) * 0.8) * amp,
      (Math.sin(t * 47.0 + 1.3) * 0.6 + (Math.random() - 0.5) * 0.8) * amp,
      (Math.sin(t * 53.0 + 2.1) * 0.5 + (Math.random() - 0.5) * 0.6) * amp * 0.7,
    );

    const orbitOwns = store.assembled && hold.settled; // once the final framing is reached, orbit controls own the camera
    if (!orbitOwns) {
      camera.position.copy(cur.pos).add(shakeOffset);
      camera.lookAt(cur.target.clone().add(shakeOffset.clone().multiplyScalar(2.5)));
    }
    fx.camPos = camera.position.clone();

    if (!orbitOwns && Math.abs(camera.fov - cur.fov) > 0.01) {
      camera.fov = cur.fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

const smoothStep = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Bloom for sparks and bright highlights; soft vignette for a cinematic frame. */
function Post() {
  if (isMobile) {
    return (
      <EffectComposer multisampling={0}>
        <Vignette offset={0.3} darkness={0.4} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={4}>
      <Bloom intensity={0.4} luminanceThreshold={0.92} luminanceSmoothing={0.2} mipmapBlur />
      <Vignette offset={0.3} darkness={0.4} />
    </EffectComposer>
  );
}
