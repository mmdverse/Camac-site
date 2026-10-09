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

const ICON_PATHS = {
  pin: <><path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  mail: <><rect x="3" y="5.5" width="18" height="13" rx="2.2" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
  phone: <path d="M6.5 3.5h3l1.5 4.2-2.1 1.4a10.5 10.5 0 0 0 5.1 5.1l1.4-2.1 4.2 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />,
  mobile: <><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  instagram: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.9" /></>,
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

function FooterItem({ row }) {
  if (!row.value) return null;
  const content = (
    <>
      <span className="sfooter-ico"><Icon name={row.icon} /></span>
      <span className="sfooter-text" dir="auto">{row.value}</span>
    </>
  );
  return row.href ? (
    <a className="sfooter-item" href={row.href} aria-label={row.label} title={row.label}>{content}</a>
  ) : (
    <span className="sfooter-item" aria-label={row.label} title={row.label}>{content}</span>
  );
}

export default function Site({ cabin }) {
  const sequenceRef = useRef(null);
  useSequenceProgress(sequenceRef);
  useAutoScroll(sequenceRef);

  const progress = useStore((s) => s.progress);
  const assembled = useStore((s) => s.assembled);
  const started = useStore((s) => s.progress > 0.02);

  return (
    <div className="site">
      {/* Progress bar: appears once the sequence starts. */}
      <div className={`chapter ${started && !assembled ? 'is-on' : ''}`} aria-hidden="true">
        <div className="chapter-bar">
          <span style={{ transform: `scaleX(${Math.min(1, progress)})` }} />
        </div>
      </div>

      {/* Scroll track for the cinematic assembly. */}
      <div ref={sequenceRef} className="sequence" aria-hidden="true" />

      <footer id="contact" className="sfooter interactive">
        <div className="sfooter-inner">
          <img className="sfooter-logo" src="/brand/logo.webp" alt={brand.name} width="110" height="110" />

          <ul className="sfooter-contact">
            {footer.contact.map((row) => (
              <li key={row.label} className={row.wide ? 'is-wide' : undefined}>
                <FooterItem row={row} />
              </li>
            ))}
          </ul>

          {footer.socials.length > 0 && (
            <ul className="sfooter-social">
              {footer.socials.map((s) => (
                <li key={s.label}>
                  <a className="sfooter-item" href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label}>
                    <span className="sfooter-ico"><Icon name={s.icon} /></span>
                    <span className="sfooter-text" dir="auto">{s.value}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sfooter-bottom">
          <span>© {new Date().getFullYear()} {brand.name}</span>
        </div>
      </footer>
    </div>
  );
}
