import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import Site from './components/Site';
import { getCabin, brand } from './data/cabins';

// Scene (three.js + R3F) is code-split so the DOM shell paints before the WebGL bundle.
const CabinScene = lazy(() => import('./components/CabinScene'));

export default function App() {
  const cabin = getCabin('pro-v6');
  const [modelReady, setModelReady] = useState(false);
  const onModelReady = useCallback(() => setModelReady(true), []);

  return (
    <>
      <div className="stage" aria-hidden="true">
        <Suspense fallback={null}>
          <CabinScene cabin={cabin} onModelReady={onModelReady} />
        </Suspense>
      </div>
      <Site cabin={cabin} />
      <Loader done={modelReady} brand={brand.name} />
    </>
  );
}

/**
 * Loading screen: only the brand video on black, with a white glitch bar along the bottom edge.
 * It fades out once the 3D model is ready and the video has finished.
 */
function Loader({ done, brand }) {
  const { progress } = useProgress();
  const [videoEnded, setVideoEnded] = useState(false);
  const [unmounted, setUnmounted] = useState(false);
  const hidden = done && videoEnded;

  useEffect(() => {
    if (!hidden) return undefined;
    const t = setTimeout(() => setUnmounted(true), 1200);
    return () => clearTimeout(t);
  }, [hidden]);

  if (unmounted) return null;

  const finish = () => setVideoEnded(true);
  return (
    <div className={`loader ${hidden ? 'is-hidden' : ''}`} role="status" aria-live="polite">
      <video
        className="loader-video"
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-label={brand}
        onEnded={finish}
        onError={finish}
      >
        <source src="/brand/loading.webm" type="video/webm" />
        <source src="/brand/loading.mp4" type="video/mp4" />
      </video>
      <div className="loader-bar">
        <span style={{ transform: `scaleX(${Math.max(0.02, progress / 100)})` }} />
      </div>
    </div>
  );
}
