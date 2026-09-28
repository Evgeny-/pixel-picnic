import { Where, type Sim } from '../core/sim';

type Rejection = Exclude<ReturnType<Sim['whyNot']>, 'ok' | 'slots'>;
export type QueueRequest = { kind: 'added' | 'removed' } | { kind: 'rejected'; reason: Rejection };

/** Player intentions only. The simulation remains responsible for every actual move. */
export class DispatchQueue {
  private order: number[] = [];

  get size(): number { return this.order.length; }
  get ids(): readonly number[] { return this.order; }

  clear(): void { this.order = []; }

  has(sim: Sim, id: number): boolean {
    return this.order.some((other) => sim.groupOf(other).includes(id));
  }

  /** Keep a feasible plan after a cancellation, shuffle or magnet changes its prerequisites. */
  reconcile(sim: Sim): void {
    const kept: number[] = [];
    for (const id of this.order) if (this.rejection(sim, id, kept) === null) kept.push(id);
    this.order = kept;
  }

  canSchedule(sim: Sim, id: number): boolean {
    return this.has(sim, id) || this.rejection(sim, id, this.order) === null;
  }

  /** A linked group occupies one place in the plan, whatever member the player taps. */
  toggle(sim: Sim, id: number): QueueRequest {
    this.reconcile(sim);
    const group = sim.groupOf(id);
    const existing = this.order.findIndex((other) => group.includes(other));
    if (existing >= 0) {
      this.order.splice(existing, 1);
      this.reconcile(sim);
      return { kind: 'removed' };
    }
    const reason = this.rejection(sim, id, this.order);
    if (reason) return { kind: 'rejected', reason };
    this.order.push(group[0]);
    return { kind: 'added' };
  }

  private rejection(sim: Sim, id: number, order: readonly number[]): Rejection | null {
    if (sim.boxWhere[id] !== Where.Queue) return 'gone';
    const group = sim.groupOf(id);
    // Plan ahead through boxes already selected, without spending slots or revealing colours.
    // A deeper box is schedulable only if earlier entries will remove all its blockers.
    const before = new Set(order.flatMap((other) => sim.groupOf(other)));
    for (const member of group) {
      if (sim.boxWhere[member] !== Where.Queue) return 'gone';
      if (sim.boxThawAt(member) > sim.taps + order.length) return 'frozen';
      const column = sim.columns[sim.boxCol[member]];
      for (const ahead of column) {
        if (ahead === member) break;
        if (!before.has(ahead) && !group.includes(ahead)) return member === id ? 'blocked' : 'link';
      }
    }
    return null;
  }

  /** Strict FIFO: a later box never silently jumps ahead of a waiting linked group. */
  next(sim: Sim): number | null {
    this.reconcile(sim);
    const id = this.order[0];
    return id !== undefined && sim.canTake(id) ? id : null;
  }

  /** Same number on every member of a queued group. */
  positions(sim: Sim): Map<number, number> {
    this.reconcile(sim);
    const result = new Map<number, number>();
    this.order.forEach((id, index) => {
      for (const member of sim.groupOf(id)) result.set(member, index + 1);
    });
    return result;
  }
}
