/**
 * Asset pipeline (docs/MVP/05 § 5): texture slots, vector-first, raster-replaceable.
 *
 *   npm run art      regenerate the editable SVG sources in assets-src/svg/ from the table data
 *   npm run assets   rasterise every slot to public/tex/ (also runs before dev and build)
 *
 * For each slot, assets-src/raster/<slot>.png (same proportions) wins over the SVG, so hand-drawn
 * or painted art can replace the generated vector art with no code change.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp, { type OverlayOptions } from 'sharp';
import { v1Table } from '../src/table/v1Table';
import { iconSvg, shareCardSvg } from './art/brand';
import { playfieldSvg } from './art/playfield';
import { standeeSvg } from './art/standees';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svgDir = join(root, 'assets-src/svg');
const rasterDir = join(root, 'assets-src/raster');
const outDir = join(root, 'public/tex');

interface Slot {
  /** Generates the SVG source (used by `npm run art`). */
  generate: () => string;
  /** Output widths (px); height follows the source's aspect ratio. */
  widths: number[];
  alpha: boolean;
}

/** The texture slot registry: names are the contract with the renderer and with artists. */
const SLOTS: Record<string, Slot> = {
  'playfield.base': { generate: () => playfieldSvg(v1Table), widths: [2048, 4096], alpha: false },
  standees: { generate: standeeSvg, widths: [600], alpha: true },
};

const fontFile = join(root, 'node_modules/@expo-google-fonts/oswald/700Bold/Oswald_700Bold.ttf');

function generateSources(): void {
  mkdirSync(svgDir, { recursive: true });
  for (const [name, slot] of Object.entries(SLOTS)) {
    writeFileSync(join(svgDir, `${name}.svg`), slot.generate());
    console.log(`art: wrote assets-src/svg/${name}.svg`);
  }
}

async function build(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) rmSync(join(outDir, f));
  const manifest: Record<string, { files: Record<number, string>; aspect: number }> = {};
  let playfieldPng: Buffer | null = null;
  for (const [name, slot] of Object.entries(SLOTS)) {
    const override = join(rasterDir, `${name}.png`);
    const svgPath = join(svgDir, `${name}.svg`);
    if (!existsSync(svgPath)) writeFileSync(svgPath, slot.generate());
    const files: Record<number, string> = {};
    let aspect = 1;
    for (const width of slot.widths) {
      let png: Buffer;
      if (existsSync(override)) {
        png = await sharp(override).resize({ width }).png().toBuffer();
      } else {
        const resvg = new Resvg(readFileSync(svgPath, 'utf8'), {
          fitTo: { mode: 'width', value: width },
          font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: 'Oswald' },
          background: slot.alpha ? 'rgba(0,0,0,0)' : '#000000',
        });
        png = Buffer.from(resvg.render().asPng());
      }
      if (name === 'playfield.base' && !playfieldPng) playfieldPng = png;
      const img = sharp(png);
      const meta = await img.metadata();
      aspect = (meta.height ?? 1) / (meta.width ?? 1);
      const webp = await img.webp({ quality: 88, alphaQuality: 100, effort: 4 }).toBuffer();
      const hash = createHash('sha1').update(webp).digest('hex').slice(0, 8);
      const file = `${name}.${width}.${hash}.webp`;
      writeFileSync(join(outDir, file), webp);
      files[width] = file;
      console.log(
        `assets: ${file} (${meta.width}×${meta.height}, ${(webp.length / 1024).toFixed(0)} KB)`,
      );
    }
    manifest[name] = { files, aspect };
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // The display font (Oswald, OFL) for the UI and the scoreboard canvas.
  mkdirSync(join(root, 'public/fonts'), { recursive: true });
  copyFileSync(fontFile, join(root, 'public/fonts/Oswald-Bold.ttf'));
  await brandImages(playfieldPng);
  // The OFL requires the license to travel with the font.
  copyFileSync(
    join(root, 'node_modules/@expo-google-fonts/oswald/LICENSE_FONT'),
    join(root, 'public/fonts/OFL.txt'),
  );
}

/** The favicon, home-screen icons and the social share card (public/). */
async function brandImages(playfield: Buffer | null): Promise<void> {
  const pub = join(root, 'public');
  const icon = iconSvg();
  writeFileSync(join(pub, 'icon.svg'), icon);
  for (const [file, size] of [
    ['apple-touch-icon.png', 180],
    ['icon-512.png', 512],
  ] as const) {
    const png = new Resvg(icon, { fitTo: { mode: 'width', value: size } }).render().asPng();
    writeFileSync(join(pub, file), png);
  }
  const card = new Resvg(shareCardSvg(), {
    font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: 'Oswald' },
  })
    .render()
    .asPng();
  const layers: OverlayOptions[] = [];
  if (playfield) {
    // The playfield art, upright on the right of the card.
    const art = await sharp(playfield).resize({ height: 590 }).png().toBuffer();
    const meta = await sharp(art).metadata();
    layers.push({ input: art, left: 1200 - (meta.width ?? 300) - 40, top: 20 });
  }
  await sharp(Buffer.from(card)).composite(layers).png().toFile(join(pub, 'og.png'));
  console.log('assets: icon.svg, apple-touch-icon.png, icon-512.png, og.png');
}

if (process.argv.includes('--generate')) generateSources();
else await build();
