/**
 * Brand images for the page (M6): the app icon (a chrome pinball with baseball stitches) and the
 * social share card. Rasterised by tools/build-assets.ts.
 */

/** The app icon: a chrome ball with red baseball stitching on the night-navy field. */
export function iconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="chrome" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.35" stop-color="#d9dee7"/>
      <stop offset="0.7" stop-color="#8a93a6"/>
      <stop offset="1" stop-color="#3b4254"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#f2b33d" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#f2b33d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#0b1020"/>
  <circle cx="256" cy="262" r="210" fill="url(#glow)"/>
  <circle cx="256" cy="256" r="168" fill="url(#chrome)"/>
  <g fill="none" stroke="#d1262c" stroke-width="12" stroke-linecap="round">
    <path d="M150 140 C 205 205, 205 307, 150 372"/>
    <path d="M362 140 C 307 205, 307 307, 362 372"/>
  </g>
  <g stroke="#d1262c" stroke-width="8" stroke-linecap="round">
    ${[0, 1, 2, 3, 4, 5]
      .map((i) => {
        const t = 0.15 + i * 0.14;
        const y = 140 + t * 232;
        const x = 150 + Math.sin(t * Math.PI) * 41;
        return `<path d="M${x - 14} ${y - 6} L${x + 14} ${y + 6}"/><path d="M${512 - x + 14} ${y - 6} L${512 - x - 14} ${y + 6}"/>`;
      })
      .join('')}
  </g>
  <ellipse cx="205" cy="188" rx="46" ry="26" fill="#ffffff" opacity="0.55" transform="rotate(-30 205 188)"/>
</svg>`;
}

/** The share card's text side (1200 × 630); the playfield art is composited on the right. */
export function shareCardSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070d"/>
      <stop offset="1" stop-color="#121a33"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <text x="70" y="250" font-family="Oswald" font-weight="700" font-size="118" fill="#f2b33d">STEEL DIAMOND</text>
  <text x="74" y="318" font-family="Oswald" font-weight="700" font-size="44" fill="#f4f1e8">Real pinball, scored like baseball.</text>
  <text x="74" y="380" font-family="Oswald" font-weight="700" font-size="30" fill="#9aa6c4">Nine innings · every drain is an out · rally for runs</text>
  <text x="74" y="560" font-family="Oswald" font-weight="700" font-size="30" fill="#f2b33d">PLAY FREE IN YOUR BROWSER</text>
</svg>`;
}
