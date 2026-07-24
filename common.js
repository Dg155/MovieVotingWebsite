/* ============================================================
   Shared helpers: preloader skip, reveals, lightbox, utilities
   ============================================================ */
/* How long the intro animation runs before content should reveal */
const PREFERS_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
window.MN_INTRO_MS = PREFERS_REDUCED ? 0 : 3100;
/* ---------- tiny DOM helpers ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
/* ---------- keep --header-h in sync with the real header ---------- */
function syncHeaderHeight() {
  const h = document.querySelector('header');
  if (h) {
    document.documentElement.style.setProperty('--header-h', h.offsetHeight + 'px');
  }
}
/* ---------- scroll reveal ---------- */
let revealObserver = null;
function getRevealObserver() {
  if (revealObserver) return revealObserver;
  if (!('IntersectionObserver' in window)) return null;
  revealObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('active');
          obs.unobserve(en.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
  );
  return revealObserver;
}
/** Observe any new .reveal elements inside `root`. */
function initReveals(root = document) {
  const els = $$('.reveal:not(.active)', root);
  const io = getRevealObserver();
  if (!io) {
    els.forEach((e) => e.classList.add('active'));
    return;
  }
  els.forEach((e) => io.observe(e));
}
/* ---------- lightbox (poster zoom) ---------- */
function initLightbox() {
  const lb    = $('#lightbox');
  const lbImg = $('#lightbox-img');
  if (!lb) return;
  function open(src) {
    lbImg.src = src;
    lb.classList.add('active');
    document.body.classList.add('scroll-locked');
  }
  function close() {
    lb.classList.remove('active');
    document.body.classList.remove('scroll-locked');
    setTimeout(() => (lbImg.src = ''), 300);
  }
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-lightbox]');
    if (trigger) { open(trigger.dataset.lightbox); return; }
    if (e.target === lb || e.target.closest('#lightbox-close')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lb.classList.contains('active')) close();
  });
}
/* ---------- film-strip placeholder ---------- */
const POSTER_FALLBACK = `
  <svg class="poster-fallback" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
    <rect x="2" y="3" width="20" height="18" rx="2"/>
    <path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5"/>
  </svg>`;
function posterHTML(url, zoomable = true) {
  if (!url) return POSTER_FALLBACK;
  const lb = zoomable ? ` data-lightbox="${esc(url)}"` : '';
  return `<img src="${esc(url)}" alt=""${lb}
            onerror="this.outerHTML=window.POSTER_FALLBACK">`;
}
window.POSTER_FALLBACK = POSTER_FALLBACK;
/* ---------- boot ---------- */
window.addEventListener('DOMContentLoaded', () => {
  syncHeaderHeight();
  initLightbox();
  setTimeout(() => initReveals(document), window.MN_INTRO_MS);
});
window.addEventListener('resize', syncHeaderHeight);