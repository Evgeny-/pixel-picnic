import { Where, type Sim } from '../core/sim';
import type { Layout } from './layout';

export interface LinkedEndpoint { box: number; visible: boolean; column: number; row: number }
export interface LinkedTarget { a: LinkedEndpoint; b: LinkedEndpoint }

/** Shared pin position and dimensions for the counter mesh and its cords. */
export function queueCounterLayout(layout: Layout, columnX: number) {
  return {
    x: columnX,
    z: layout.queueZ0 + (layout.queueRowsVisible - (layout.queueRow > 0 ? 0.4 : -0.15)) * layout.queueRow,
    y: 0.04,
    width: layout.boxSize * 0.68,
    height: layout.boxSize * 0.40,
  };
}

/** Physical links remain represented when just one end is below the visible queue. */
export function linkedTargets(sim: Sim, visibleRows: number): LinkedTarget[] {
  const seen = new Set<number>();
  const result: LinkedTarget[] = [];
  const endpoint = (box: number): LinkedEndpoint => {
    const column = sim.boxCol[box];
    const row = sim.columns[column]?.indexOf(box) ?? -1;
    return { box, column, row, visible: sim.boxWhere[box] === Where.Slot || (sim.boxWhere[box] === Where.Queue && row < visibleRows) };
  };
  for (let id = 0; id < sim.boxIds; id++) {
    const link = sim.boxLink(id);
    if (link < 0 || seen.has(link)) continue;
    seen.add(link);
    const members = sim.groupOf(id).filter((box) => sim.boxWhere[box] !== Where.Done);
    for (let i = 0; i + 1 < members.length; i++) {
      const a = endpoint(members[i]), b = endpoint(members[i + 1]);
      if (a.visible || b.visible) result.push({ a, b });
    }
  }
  return result;
}
