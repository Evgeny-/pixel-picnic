/** Side of the picture frame through which ants can reach cubes. */
export type Side = 'bottom' | 'top' | 'left' | 'right';
export const SIDES: readonly Side[] = ['bottom', 'top', 'left', 'right'];

export interface Localized {
  en: string;
  ru: string;
}

/** Pixel-art picture. Row 0 is the TOP row. */
export interface PictureDef {
  id: string;
  w: number;
  h: number;
  /** '#rrggbb' colors; index = color id used by boxes. */
  palette: string[];
  /** w*h chars, row-major: '.' = empty, otherwise base-36 palette index. */
  cells: string;
}

export interface BoxDef {
  id: number;
  color: number;
  /** Number of ants inside = number of cubes this box will eat. */
  count: number;
  /** Color stays secret until the box reaches the front of its column. */
  hidden?: boolean;
  /** Boxes sharing a link id can only be taken together. */
  link?: number;
  /** Box is frozen until this many taps have been made in the level. */
  frozen?: number;
}

export type Tier = 'normal' | 'hard' | 'superhard';

export interface LevelStats {
  /** Win rate of a "casual" random-but-sensible player (0..1). */
  casual: number;
  /** Win rate of a greedy player (0..1). */
  greedy: number;
  /** Win rate of tapping boxes at random. */
  random?: number;
  /** DFS nodes the solver needed to find a solution. */
  nodes: number;
  /** Decisions on the solution path where a wrong box leads into a dead end. */
  critical?: number;
  /** Decisions on the solution path with more than one available box. */
  decisions?: number;
  pixels: number;
  boxes: number;
  colors: number;
}

/**
 * A fence along one side of the frame: ants can't enter through cells [from, to) of that side
 * (counted left to right for top/bottom, top to bottom for left/right). Gaps between fences are gates.
 */
export interface Fence {
  side: Side;
  from: number;
  to: number;
}

/** What the picture's pieces look like (one shape per level). */
export type PieceShape = 'cube' | 'coin' | 'candy' | 'hex' | 'diamond';
export const PIECE_SHAPES: readonly PieceShape[] = ['cube', 'coin', 'candy', 'hex', 'diamond'];

export interface LevelDef {
  n: number;
  world: number;
  tier: Tier;
  picture: PictureDef;
  name?: Localized;
  slots: number;
  /** Fenced parts of the frame; everything else is open (no fences = ants enter from all sides). */
  fences?: Fence[];
  shape?: PieceShape;
  boxes: BoxDef[];
  /** Queue columns: box ids, index 0 = front (closest to the slots). */
  columns: number[][];
  /** A known solution (box ids in tap order), used for tests/debug. */
  solution?: number[];
  stats?: LevelStats;
}

export function decodeCells(p: PictureDef): Int16Array {
  const out = new Int16Array(p.w * p.h);
  for (let i = 0; i < out.length; i++) {
    const ch = p.cells.charCodeAt(i);
    out[i] = ch === 46 /* . */ ? -1 : parseInt(p.cells[i], 36);
  }
  return out;
}

export function encodeCells(cells: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < cells.length; i++) s += cells[i] < 0 ? '.' : cells[i].toString(36);
  return s;
}

export function tierForLevel(n: number): Tier {
  if (n >= 10 && n % 10 === 0) return 'superhard';
  if (n >= 5 && n % 5 === 0) return 'hard';
  return 'normal';
}
