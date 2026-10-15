/**
 * The loading screen (#loader in index.html): shown from the first paint, before any script runs,
 * while the renderer starts, the table is built, the textures load and the shaders compile; then
 * it fades out over the title screen.
 */

let shown = 0;

/** Move the bar to `fraction` (0–1; it never goes back) and say what is loading. */
export function loadProgress(fraction: number, status: string): void {
  const el = document.getElementById('loader');
  if (!el) return;
  shown = Math.max(shown, Math.min(1, fraction));
  el.style.setProperty('--progress', String(shown));
  el.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
  const s = el.querySelector('.loader-status');
  if (s) s.textContent = status;
}

/** Fade the loading screen out (at once with reduced motion) and remove it. */
export function hideLoader(instant = false): void {
  const el = document.getElementById('loader');
  if (!el || el.classList.contains('done')) return;
  loadProgress(1, 'Play ball!');
  el.classList.add('done');
  if (instant) el.remove();
  else setTimeout(() => el.remove(), 600);
}
