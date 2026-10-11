/** Layout of the standee atlas texture (tools/art/standees.ts draws it; the renderer cuts cells). */
export const STANDEE_CELLS = [
  'LF',
  'CF',
  'RF',
  '3B',
  'SS',
  '2B',
  '1B',
  'P',
  'RUNNER',
  'C',
  'UMP',
  'SPARE',
] as const;
export type StandeeCell = (typeof STANDEE_CELLS)[number];
export const STANDEE_GRID = { cols: 3, rows: 4, cellW: 200, cellH: 400 };
