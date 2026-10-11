/** Writes the name-candidate wordmark sheet as SVG and PNG into docs/MVP/assets/. */
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { NAME_CANDIDATES, NAME_CANDIDATES_2, namesSvg } from './art/names';

const font = {
  fontFiles: ['node_modules/@expo-google-fonts/oswald/700Bold/Oswald_700Bold.ttf'],
  loadSystemFonts: false,
  defaultFontFamily: 'Oswald',
};
for (const [file, list] of [
  ['name-candidates', NAME_CANDIDATES],
  ['name-candidates-2', NAME_CANDIDATES_2],
] as const) {
  const svg = namesSvg(list);
  writeFileSync(`docs/MVP/assets/${file}.svg`, svg);
  writeFileSync(`docs/MVP/assets/${file}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: 1000 }, font }).render().asPng());
  console.log(`wrote docs/MVP/assets/${file}.{svg,png}`);
}
