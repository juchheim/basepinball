/** Wordmark sheet for the name candidates (docs/MVP/naming.md). */
export const NAME_CANDIDATES: { name: string; line: string }[] = [
  { name: 'Extra Innings', line: "Pinball's extra ball meets baseball's extra innings" },
  { name: 'Night Game', line: 'Named for the look: a ballpark under the lights' },
  {
    name: 'Silverball Classic',
    line: 'Pinball slang + a baseball classic; ties to the Silverballs',
  },
  { name: 'Plunger Park', line: 'The ballpark itself; playful and ownable' },
  { name: 'Diamond Flip', line: 'Short, says baseball + pinball in two words' },
  { name: 'BasePinball', line: 'The working title: clear, descriptive' },
];

/** Round 2 (more options requested). */
export const NAME_CANDIDATES_2: { name: string; line: string }[] = [
  {
    name: 'Pop Fly',
    line: 'Pop bumpers + a pop fly: the pinball and baseball meanings in two words',
  },
  {
    name: 'Rally Ball',
    line: 'Named for the rally mechanic: keep the ball live, keep the inning alive',
  },
  { name: 'Swing & Flip', line: 'Says both games outright; friendly and clear' },
  { name: 'Moonshot', line: 'Slang for a towering home run; works as a logo and a ramp name' },
  { name: 'Flipper Field', line: 'Plain-spoken: a ballfield made of flippers' },
  { name: 'Fair or Foul', line: 'Every shot is a call; pairs with the foul-out outlanes' },
  { name: 'Can of Corn', line: 'Baseball slang for an easy fly ball; quirky and memorable' },
  {
    name: 'Seventh-Inning Tilt',
    line: 'Seventh-inning stretch with a pinball twist; playful but long',
  },
];

const xml = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function namesSvg(candidates = NAME_CANDIDATES): string {
  const rowH = 150;
  const rows = candidates.map(({ name, line }, i) => {
    const y = 40 + i * rowH;
    return `<g transform="translate(40 ${y})">
  <rect width="920" height="${rowH - 20}" rx="14" fill="#141b33" stroke="#2a3557"/>
  <path d="M 30 26 q 12 -10 24 0 q 12 10 24 0" fill="none" stroke="#ff3b3b" stroke-width="3" stroke-dasharray="5 4"/>
  <text x="30" y="88" font-family="Oswald" font-weight="700" font-size="64" fill="#f2b33d" letter-spacing="2">${xml(name.toUpperCase())}</text>
  <text x="30" y="116" font-family="Oswald" font-weight="700" font-size="18" fill="#9aa6c4" letter-spacing="1">${xml(line)}</text>
  <text x="890" y="88" text-anchor="end" font-family="Oswald" font-weight="700" font-size="20" fill="#f4f1e8" opacity="0.5">${i + 1}</text>
</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${40 + candidates.length * rowH}">
<rect width="100%" height="100%" fill="#0b1020"/>
${rows.join('\n')}
</svg>
`;
}
