import { useEffect } from 'react';

/**
 * Feeds page scrolling into the SplashCursor fluid. The original component reacts to pointer movement on
 * `window`; here every scroll step is turned into a pointer move whose speed follows the scroll speed, so
 * scrolling pushes the yellow fluid the same way a moving pointer does. The component itself is unchanged.
 */
export default function useScrollSplash() {
  useEffect(() => {
    let y = window.innerHeight * 0.5; // virtual pointer height, kept on screen
    let last = window.scrollY;
    let t = 0;
    const onScroll = () => {
      const raw = window.scrollY - last;
      last = window.scrollY;
      if (!raw) return;
      const dy = Math.max(-60, Math.min(60, raw)); // a large jump (reset to top) does not splash hard
      y = Math.min(window.innerHeight - 1, Math.max(1, y + dy * 1.5));
      t += 0.05;
      const x = window.innerWidth * (0.5 + 0.12 * Math.sin(t)); // a slight sideways wobble
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
}
