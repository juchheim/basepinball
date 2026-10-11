/** Writes the name-candidate wordmark sheet as SVG and PNG into docs/MVP/assets/. */
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { namesSvg } from './art/names';

const svg = namesSvg();
writeFileSync('docs/MVP/assets/name-candidates.svg', svg);
const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1000 },
  font: {
    fontFiles: ['node_modules/@expo-google-fonts/oswald/700Bold/Oswald_700Bold.ttf'],
    loadSystemFonts: false,
    defaultFontFamily: 'Oswald',
  },
}).render();
writeFileSync('docs/MVP/assets/name-candidates.png', png.asPng());
console.log(
  'wrote docs/MVP/assets/name-candidates.{svg,png}',
  readFileSync('docs/MVP/assets/name-candidates.png').length,
);
