# Art sources

Every texture in the game is a **slot** with a fixed name (docs/MVP/05 § 5). Each slot's art
comes from, in order of priority:

1. **`raster/<slot>.png`**: drop in a painted or photographic replacement. It wins, with no code
   change.
2. **`svg/<slot>.svg`**: the editable vector source. It is generated from the table data by
   `npm run art`, and can be edited by hand. If you edit it, don't re-run `npm run art`, because
   that overwrites it.

`npm run assets` (which also runs automatically before `dev` and `build`) rasterises every slot into
`public/tex/` as WebP at each size the quality tiers use.

| Slot | Size and aspect | Contents |
|------|-----------------|----------|
| `playfield.base` | 590 × 1170 mm playfield; any width with aspect 1 : 1.983. Built at 2048 and 4096 px. | The printed playfield. Origin at the bottom-left; the top of the image is the far end of the table. Holes, inserts and posts must line up with [the generated layout](../docs/MVP/assets/playfield-layout-v1-generated.svg), so trace over `svg/playfield.base.svg`. |
| `standees` | 600 × 1600 px, transparent, a 3 × 4 grid of 200 × 400 cells | Player figures, in cell order: LF, CF, RF, 3B, SS, 2B, 1B, P, RUNNER, C, UMP, (spare). The figure's feet should touch the bottom of its cell. |
