import { lazy, Suspense, useCallback, useState } from 'react';
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

function Loader({ done, brand }) {
  const { progress } = useProgress();
  const hidden = done;
  return (
    <div className={`loader ${hidden ? 'is-hidden' : ''}`} role="status" aria-live="polite">
      <div className="loader-brand">{brand}</div>
      <div className="loader-bar">
        <span style={{ transform: `scaleX(${Math.max(0.05, progress / 100)})` }} />
      </div>
      <div className="loader-pct">{Math.round(progress)}%</div>
    </div>
  );
}
