# Third-party license manifest

Acceptance criterion 9 ([docs/MVP/07 § 5](../docs/MVP/07-roadmap-and-scope.md#5-mvp-acceptance-criteria)):
every third-party asset and library that ships to players is listed here with a compatible
license. Update this file whenever something new ships.

## Shipped to players

| What | Where it ships | Source | License | Notes |
|---|---|---|---|---|
| Oswald Bold (font) | `public/fonts/Oswald-Bold.ttf`; also used in the generated playfield art | The Oswald Project Authors, via `@expo-google-fonts/oswald` 0.4.2 | SIL OFL 1.1 | The license text ships next to the font as `public/fonts/OFL.txt` (copied by `npm run assets`). The font is not sold on its own and is not renamed. |
| three.js | JS bundle | `three` 0.186.1 | MIT | |
| Preact | JS bundle | `preact` 11.0.1 | MIT | |
| @preact/signals | JS bundle | `@preact/signals` 2.11.3 and `@preact/signals-core` 1.14.4 | MIT | |
| Tweakpane | Separate chunk, loaded only with `?debug` | `tweakpane` 4.0.5 | MIT | Developer tuning panel. |

## Made for the game (no third-party rights)

| What | How it is made |
|---|---|
| Playfield art, standees, backboard | Generated from the table data by `tools/art/*.ts` (`npm run art`) |
| Every sound: mechanical SFX, crowd, organ, UI | Synthesised at run time with Web Audio (`src/audio/`). No audio files ship. |
| Organ stingers | Original note data in `src/audio/organ.ts`. No ballpark standards are quoted. |
| Name, team and park ("Rally Ball", "Tilt City Silverballs", "Plunger Park") | Original. A trademark check is still due before launch (M6). |

## Build-time only (not shipped)

`@resvg/resvg-js` (MPL-2.0), `sharp` (Apache-2.0), Vite, Vitest, TypeScript, ESLint, Prettier,
tsx, `@dimforge/rapier3d-compat` (benchmark only). None of their code or assets reach the browser.

## Raster overrides

A PNG placed in `assets-src/raster/` replaces generated art (see `assets-src/README.md`). Any such
file must be added to the first table with its source and license before it is committed.
