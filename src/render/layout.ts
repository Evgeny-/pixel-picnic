/** World-space placement of every gameplay element (XZ plane, Y up; -Z is "up" on screen). */
export interface Layout {
  mode: 'portrait' | 'landscape';
  tilt: number;
  cell: number;
  /** Picture area: x0/z0 = top-left corner of cell (0,0). */
  picX0: number;
  picZ0: number;
  picW: number;
  picH: number;
  frame: number;
  nest: { x: number; z: number };
  slot: { x: number; z: number }[];
  slotSize: number;
  queueCol: number[];
  queueZ0: number;
  queueRow: number;
  queueRowsVisible: number;
  boxSize: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface LayoutInput {
  aspect: number;
  w: number;
  h: number;
  slots: number;
  columns: number;
  /** Queue rows the player can see. */
  rows: number;
}

const BOX = 1.2;
const SPACING = 1.62;
const ROW = 1.48;

export function computeLayout(inp: LayoutInput): Layout {
  return inp.aspect > 1.15 ? landscape(inp) : portrait(inp);
}

function rowX(n: number, cx: number, spacing: number): number[] {
  return Array.from({ length: n }, (_, i) => cx + (i - (n - 1) / 2) * spacing);
}

function portrait(inp: LayoutInput): Layout {
  // The picture gets the full width (square pictures too); the ant house, the slots and the
  // visible queue rows are packed tightly below it.
  const maxW = 9.2;
  const maxH = 9.2;
  const cell = Math.min(maxW / inp.w, maxH / inp.h);
  const picW = cell * inp.w;
  const picH = cell * inp.h;
  const frame = 0.32;
  const picX0 = -picW / 2;
  const picZ0 = -picH;
  const nest = { x: 0, z: 1.42 };
  const slotZ = 3.05;
  const slotSpacing = inp.slots > 5 ? Math.min(SPACING, 9.4 / inp.slots) : SPACING;
  const slot = rowX(inp.slots, 0, slotSpacing).map((x) => ({ x, z: slotZ }));
  const colSpacing = inp.columns > 5 ? 9.4 / inp.columns : SPACING;
  const queueCol = rowX(inp.columns, 0, colSpacing);
  const queueZ0 = slotZ + 1.95;
  const rowsVisible = inp.rows;
  const maxX = Math.max(picW / 2 + frame + cell * 0.35, (slot.length * slotSpacing) / 2, (inp.columns * colSpacing) / 2) + 0.08;
  return {
    mode: 'portrait',
    tilt: (30 * Math.PI) / 180,
    cell,
    picX0,
    picZ0,
    picW,
    picH,
    frame,
    nest,
    slot,
    slotSize: Math.min(BOX, slotSpacing * 0.78),
    queueCol,
    queueZ0,
    queueRow: ROW,
    queueRowsVisible: rowsVisible,
    boxSize: Math.min(BOX, colSpacing * 0.78, slotSpacing * 0.78),
    // The bottom edge leaves room for the "+3" hints under the columns.
    bounds: { minX: -maxX, maxX, minZ: picZ0 - frame - cell * 0.35 - 0.12, maxZ: queueZ0 + (rowsVisible - 0.4) * ROW + 0.45 },
  };
}

function landscape(inp: LayoutInput): Layout {
  const maxW = 11;
  const maxH = 10.4;
  const cell = Math.min(maxW / inp.w, maxH / inp.h);
  const picW = cell * inp.w;
  const picH = cell * inp.h;
  const frame = 0.36;
  const boardCx = -6.2;
  const bottom = 3.9;
  const picX0 = boardCx - picW / 2;
  const picZ0 = bottom - picH;
  // Slots sit at the bottom right with the queue stacked above them, so the ant trail
  // (slots -> picture bottom -> nest) never crosses the boxes.
  const rightCx = 5.6;
  const slotSpacing = inp.slots > 5 ? Math.min(SPACING, 9 / inp.slots) : SPACING;
  const slotZ = 3.7;
  const slot = rowX(inp.slots, rightCx, slotSpacing).map((x) => ({ x, z: slotZ }));
  const colSpacing = inp.columns > 5 ? 9 / inp.columns : SPACING;
  const queueCol = rowX(inp.columns, rightCx, colSpacing);
  const queueZ0 = slotZ - 1.75;
  const rowsVisible = inp.rows;
  // The nest sits under the middle of the picture, as in portrait: ants fetch the pieces closest
  // to home first, so that's where the rules measure distances from.
  const nest = { x: boardCx, z: bottom + 1.45 };
  // Room above the top row for the "+3" hints.
  const queueTop = queueZ0 - (rowsVisible + 0.15) * ROW - 0.4;
  const minX = Math.min(picX0 - frame, rightCx - (slot.length * slotSpacing) / 2) - 0.3;
  const maxX = Math.max(rightCx + (slot.length * slotSpacing) / 2, rightCx + (inp.columns * colSpacing) / 2) + 0.3;
  return {
    mode: 'landscape',
    tilt: (28 * Math.PI) / 180,
    cell,
    picX0,
    picZ0,
    picW,
    picH,
    frame,
    nest,
    slot,
    slotSize: Math.min(BOX, slotSpacing * 0.78),
    queueCol,
    queueZ0,
    queueRow: -ROW,
    queueRowsVisible: rowsVisible,
    boxSize: Math.min(BOX, colSpacing * 0.78, slotSpacing * 0.78),
    bounds: {
      minX,
      maxX,
      minZ: Math.min(picZ0 - frame, queueTop) - 0.25,
      maxZ: Math.max(bottom + frame, nest.z + 0.9, slotZ + 0.9) + 0.3,
    },
  };
}

/** Center of picture cell (x, y) in world XZ. */
export function cellCenter(l: Layout, x: number, y: number): { x: number; z: number } {
  return { x: l.picX0 + (x + 0.5) * l.cell, z: l.picZ0 + (y + 0.5) * l.cell };
}

export function queuePos(l: Layout, col: number, row: number): { x: number; z: number } {
  return { x: l.queueCol[col], z: l.queueZ0 + row * l.queueRow };
}
