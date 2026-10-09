import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { brand } from '../data/cabins';
import { footer } from '../data/footer';
import { store } from '../lib/store';
import { fx } from '../lib/fx';
import { useStore } from '../lib/useStore';

gsap.registerPlugin(ScrollTrigger);

const ASSEMBLED_AT = 0.985;

/**
 * The sequence spacer is the scroll track for the cinematic assembly.
 * Its progress (0..1) drives the 3D scene; after it ends, progress stays at 1.
 */
function useSequenceProgress(ref) {
  useEffect(() => {
    const trigger = ScrollTrigger.create({
      trigger: ref.current,
      start: 'top top',
      end: 'bottom bottom',
      scrub: false,
      onUpdate: (self) => {
        const seq = store.sequence;
        const p = seq ? seq.map.toProgress(self.progress) : self.progress;
        store.set({ progress: p, assembled: p >= ASSEMBLED_AT });
      },
    });
    return () => trigger.kill();
  }, [ref]);
}

const AUTO_IDLE_MS = 3000; // after this much time without input, the page moves on by itself
const AUTO_RUN_MS = 120000; // the whole sequence plays through in about this long (slow glide)
const USER_EVENTS = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'];

/**
 * Auto-scroll: after the first user scroll, once the user has been idle for AUTO_IDLE_MS the page
 * glides on by itself through the whole sequence, without stopping at each piece. Pieces land as
 * they pass. The speed eases in and out. Any user input stops it at once; the idle timer restarts
 * from that input.
 */
function useAutoScroll(ref) {
  useEffect(() => {
    let hasScrolled = false;
    let running = false;
    let lastActivity = performance.now();
    let velocity = 0; // px per second
    let lastNow = 0;
    let raf = 0;

    const cancel = () => {
      running = false;
      fx.autoScroll = false;
      velocity = 0; // stop dead so it never fights the user's own scroll
      hasScrolled = true;
      lastActivity = performance.now();
    };
    USER_EVENTS.forEach((e) => window.addEventListener(e, cancel, { passive: true }));

    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0;
      lastNow = now;
      const el = ref.current;
      if (!el || !store.sequence) return;

      if (!running && hasScrolled && !store.assembled && now - lastActivity >= AUTO_IDLE_MS) {
        running = true;
      }
      if (running && store.progress >= 0.999) {
        running = false; // the sequence is complete: stay here
      }
      fx.autoScroll = running;

      const track = el.offsetHeight - window.innerHeight;
      const target = running && track > 0 ? (track / AUTO_RUN_MS) * 1000 : 0;
      // ease the speed in and out so the glide starts and ends softly
      velocity += (target - velocity) * (1 - Math.exp(-dt * 1.5));
      if (Math.abs(velocity) < 0.5) {
        velocity = 0;
        return;
      }
      window.scrollTo({ top: window.scrollY + velocity * dt, behavior: 'instant' });
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      USER_EVENTS.forEach((e) => window.removeEventListener(e, cancel));
    };
  }, [ref]);
}

function FooterValue({ value }) {
  return value ? <span>{value}</span> : <span className="sfooter-soon">به‌زودی</span>;
}

export default function Site({ cabin }) {
  const sequenceRef = useRef(null);
  useSequenceProgress(sequenceRef);
  useAutoScroll(sequenceRef);

  const progress = useStore((s) => s.progress);
  const assembled = useStore((s) => s.assembled);
  const exploded = useStore((s) => s.exploded);
  const started = useStore((s) => s.progress > 0.02);

  return (
    <div className="site">
      <header className={`topbar interactive ${assembled ? 'is-on' : ''}`}>
        <a className="wordmark" href="#top" aria-label={brand.name}>
          <img src="/brand/logo.webp" alt={brand.name} width="44" height="44" />
        </a>
        <nav className="nav">
          <a href="#contact">تماس</a>
        </nav>
      </header>

      {/* Progress bar: appears once the sequence starts. */}
      <div className={`chapter ${started && !assembled ? 'is-on' : ''}`} aria-hidden="true">
        <div className="chapter-bar">
          <span style={{ transform: `scaleX(${Math.min(1, progress)})` }} />
        </div>
      </div>

      {assembled && (
        <button
          type="button"
          className="explode-btn interactive"
          onClick={() => {
            const next = !store.exploded;
            fx.explodeT = next ? 1 : 0;
            store.set({ exploded: next });
          }}
        >
          {exploded ? 'جمع کردن' : 'اکسپلود ویو'}
        </button>
      )}

      {/* Finale copy: appears when the cabin is complete. */}
      <div className={`finale ${assembled ? 'is-on' : ''}`} aria-hidden={!assembled}>
        <p className="eyebrow">{cabin.name}</p>
        <h1>{brand.tagline}</h1>
        <p className="muted">متن نمونه — جایگزین با متن نهایی برند</p>
        <div className="finale-cue">اطلاعات تماس در پایین صفحه ↓</div>
      </div>

      {/* Scroll track for the cinematic assembly. */}
      <div ref={sequenceRef} className="sequence" aria-hidden="true" />

      <footer id="contact" className="sfooter interactive">
        <div className="sfooter-inner">
          <div className="sfooter-brand">
            <img src="/brand/logo.webp" alt={brand.name} width="96" height="96" />
            <p>{brand.tagline}</p>
          </div>

          <div className="sfooter-col">
            <h4>تماس</h4>
            {footer.contact.map((row) => (
              <div className="sfooter-row" key={row.label}>
                <span>{row.label}</span>
                <FooterValue value={row.value} />
              </div>
            ))}
          </div>

          <div className="sfooter-col">
            <h4>شبکه‌های اجتماعی</h4>
            {footer.socials.length > 0 ? (
              <ul className="sfooter-social">
                {footer.socials.map((s) => (
                  <li key={s.label}>
                    <a href={s.href} target="_blank" rel="noopener noreferrer">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sfooter-soon">به‌زودی</p>
            )}
          </div>
        </div>

        <div className="sfooter-bottom">
          <span>© {new Date().getFullYear()} {brand.name}</span>
        </div>
      </footer>
    </div>
  );
}
