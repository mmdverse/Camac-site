import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { brand } from '../data/cabins';
import { chapterIndex } from '../lib/assembly';
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

/** Fades and lifts every [data-reveal] element as it enters the viewport. */
function useReveals() {
  useEffect(() => {
    const els = gsap.utils.toArray('[data-reveal]');
    const tweens = els.map((el) =>
      gsap.fromTo(
        el,
        { opacity: 0, y: 36 },
        {
          opacity: 1,
          y: 0,
          duration: 1.1,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none reverse' },
        },
      ),
    );
    return () => {
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
    };
  }, []);
}

export default function Site({ cabin }) {
  const sequenceRef = useRef(null);
  useSequenceProgress(sequenceRef);
  useAutoScroll(sequenceRef);
  useReveals();

  const steps = cabin.assembly;
  const chapter = useStore((s) => chapterIndex(s.progress, steps));
  const progress = useStore((s) => s.progress);
  const assembled = useStore((s) => s.assembled);
  const started = useStore((s) => s.progress > 0.02);

  const selected = useStore((s) => s.selected);
  const hovered = useStore((s) => s.hovered);
  const activeId = selected ?? hovered;
  const activePart = cabin.parts.find((p) => p.id === activeId) ?? null;

  return (
    <div className="site">
      <header className={`topbar interactive ${assembled ? 'is-on' : ''}`}>
        <a className="wordmark" href="#top" aria-label="CAMAC">
          {brand.name}
        </a>
        <nav className="nav">
          <a href="#parts">قطعات</a>
          <a href="#specs">مشخصات</a>
          <a href="#contact">تماس</a>
        </nav>
      </header>

      {/* Chapter HUD: appears once the sequence starts; shows what is being assembled. */}
      <div className={`chapter ${started && !assembled ? 'is-on' : ''}`} aria-live="polite">
        <div className="chapter-index">
          {String(chapter + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
        </div>
        <div className="chapter-label">{steps[chapter]?.label}</div>
        <div className="chapter-bar">
          <span style={{ transform: `scaleX(${Math.min(1, progress)})` }} />
        </div>
      </div>

      {/* Finale copy: appears when the cabin is complete. */}
      <div className={`finale ${assembled ? 'is-on' : ''}`} aria-hidden={!assembled}>
        <p className="eyebrow">{cabin.name}</p>
        <h1>{brand.tagline}</h1>
        <p className="muted">متن نمونه — جایگزین با متن نهایی برند</p>
        <div className="finale-cue">قطعات را از نزدیک ببینید ↓</div>
      </div>

      {/* Scroll track for the cinematic assembly. */}
      <div ref={sequenceRef} className="sequence" aria-hidden="true" />

      <section id="parts" className="section parts">
        <div className="parts-head" data-reveal>
          <p className="eyebrow">ساختار کابین</p>
          <h2>هر قطعه را از نزدیک ببینید</h2>
          <p className="muted">روی قطعه‌ی مدل یا فهرست زیر حرکت کنید تا آن بخش برجسته شود.</p>
        </div>
        <ul className="parts-list interactive" data-reveal>
          {cabin.parts.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={`part-chip ${activeId === p.id ? 'is-active' : ''}`}
                onMouseEnter={() => store.set({ hovered: p.id })}
                onMouseLeave={() => store.set({ hovered: null })}
                onFocus={() => store.set({ hovered: p.id })}
                onBlur={() => store.set({ hovered: null })}
                onClick={() => store.set({ selected: store.selected === p.id ? null : p.id })}
                aria-pressed={selected === p.id}
              >
                {p.label}
              </button>
            </li>
          ))}
        </ul>
        <article className="part-card interactive" aria-live="polite" data-reveal>
          {activePart ? (
            <>
              <h3>{activePart.title}</h3>
              <p>{activePart.description}</p>
              {activePart.placeholder && <span className="badge">متن موقت</span>}
            </>
          ) : (
            <p className="muted">یک قطعه را انتخاب کنید.</p>
          )}
        </article>
      </section>

      <section id="specs" className="section specs interactive" data-reveal>
        <p className="eyebrow">مشخصات</p>
        <dl className="spec-grid">
          {cabin.specs.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="muted small">مقادیر فنی هنوز تأیید نشده‌اند.</p>
      </section>

      <section id="contact" className="section contact interactive" data-reveal>
        <p className="eyebrow">تماس</p>
        <h2>کابین خود را طراحی کنید</h2>
        <a className="cta" href="mailto:info@example.com">
          درخواست مشاوره
        </a>
      </section>

      <footer className="footer interactive">
        <span>© {new Date().getFullYear()} {brand.name}</span>
      </footer>
    </div>
  );
}
