import * as THREE from 'three';
import type { Sim } from '../core/sim';
import { BOX_H } from './boxStyle';
import type { Layout } from './layout';
import { linkedTargets, queueCounterLayout, type LinkedEndpoint } from './chainRouting';
import { routeCords, roundCord, type CordObstacle, type CordPoint } from './cordRouting';
import { BoxCord } from './BoxCord';

interface LinkBox {
  group: THREE.Group;
  body?: THREE.Mesh;
  to: THREE.Vector3;
  where: 'queue' | 'slot' | 'gone';
  fade: number;
}
interface LinkEnd extends CordObstacle { box?: number; color: THREE.Color }
interface LinkVis { cord: BoxCord; a: LinkEnd; b: LinkEnd; start: CordPoint; end: CordPoint }
const NEUTRAL = new THREE.Color('#e5d9c1');

/** Always-visible cords follow the box colors, with neutral ends for undisclosed partners. */
export class QueueLinks {
  private readonly links: LinkVis[] = [];
  private cacheKey = '';
  private tilt = 0;
  private size = 1;
  private readonly offsets = new Float64Array(4);
  private readonly material = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, transparent: true,
    depthTest: false, depthWrite: false, toneMapped: false,
  });

  constructor(_sim: Sim, private readonly boxes: ReadonlyMap<number, LinkBox>, private readonly group: THREE.Group,
    private readonly colors: readonly THREE.Color[] = []) {}

  sync(sim: Sim, layout: Layout, columnX: (column: number) => number): void {
    const targets = linkedTargets(sim, layout.queueRowsVisible);
    const size = layout.boxSize, cos = Math.cos(layout.tilt), sin = Math.sin(layout.tilt);
    const obstacles: CordObstacle[] = [];
    for (const [id, box] of this.boxes) {
      const row = sim.columns[sim.boxCol[id]]?.indexOf(id) ?? -1;
      if (box.where !== 'slot' && !(box.where === 'queue' && row >= 0 && row < layout.queueRowsVisible)) continue;
      obstacles.push({ id, x: box.to.x, z: box.to.z * cos - (box.to.y + BOX_H * size * .5) * sin,
        halfX: size * .5, halfZ: size * .5 * cos + BOX_H * size * .5 * sin });
    }
    sim.columns.forEach((column, c) => {
      if (column.length <= layout.queueRowsVisible) return;
      const p = queueCounterLayout(layout, columnX(c));
      obstacles.push({ id: -1 - c, x: p.x, z: p.z * cos - p.y * sin, halfX: p.width * .49, halfZ: p.height * .49 });
    });
    const byId = new Map(obstacles.map(o => [o.id, o]));
    const endpoint = (end: LinkedEndpoint): LinkEnd => ({
      ...byId.get(end.visible ? end.box : -1 - end.column)!,
      box: end.visible ? end.box : undefined,
      color: end.visible && !sim.boxHidden[end.box] ? this.colors[sim.boxColor(end.box)] ?? NEUTRAL : NEUTRAL,
    });
    const plans = targets.map(({ a, b }) => ({ a: endpoint(a), b: endpoint(b) }));
    // Ant rounds change counts without moving the queue. Reuse both the paths and their geometry.
    const key = JSON.stringify([size, layout.tilt, obstacles, plans.map(p => [p.a.id, p.b.id, p.a.color.getHex(), p.b.color.getHex()])]);
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    this.clear();
    this.tilt = layout.tilt;
    this.size = size;
    const routes = routeCords(obstacles, plans.map(p => ({ a: p.a.id, b: p.b.id })), size).map(p => roundCord(p, size * .11));
    plans.forEach((plan, index) => {
      const route = routes[index];
      if (route.length < 2) return;
      const cord = new BoxCord(route, routes.slice(index + 1), size, layout.tilt, plan.a.color, plan.b.color, this.material, index);
      cord.mesh.userData.link = `${targets[index].a.box}:${targets[index].b.box}`;
      this.group.add(cord.mesh);
      this.links.push({ cord, ...plan, start: route[0], end: route.at(-1)! });
    });
  }

  update(_size: number): void {
    const cos = Math.cos(this.tilt), sin = Math.sin(this.tilt);
    for (const link of this.links) {
      const a = link.a.box === undefined ? undefined : this.boxes.get(link.a.box);
      const b = link.b.box === undefined ? undefined : this.boxes.get(link.b.box);
      const visible = (box: LinkBox | undefined) => !box || (box.group.visible && box.where !== 'gone' && box.fade > .3);
      link.cord.mesh.visible = visible(a) && visible(b);
      if (!link.cord.mesh.visible) continue;
      // Pins follow jumps, hint bounces, shrinking and the small shake on an unavailable box.
      this.pinOffset(a, link.a, link.start, 0, cos, sin);
      this.pinOffset(b, link.b, link.end, 2, cos, sin);
      link.cord.update(this.offsets[0], this.offsets[1], this.offsets[2], this.offsets[3]);
    }
  }

  private pinOffset(box: LinkBox | undefined, end: LinkEnd, pin: CordPoint, i: number, cos: number, sin: number): void {
    if (!box) { this.offsets[i] = this.offsets[i + 1] = 0; return; }
    const p = box.group.position, s = box.group.scale;
    const sx = s.x / this.size;
    const sz = (s.z * cos + BOX_H * s.y * sin) / (this.size * (cos + BOX_H * sin));
    this.offsets[i] = p.x + (box.body?.position.x ?? 0) * s.x - end.x + (pin.x - end.x) * (sx - 1);
    this.offsets[i + 1] = p.z * cos - (p.y + BOX_H * s.y * .5) * sin - end.z + (pin.z - end.z) * (sz - 1);
  }

  private clear(): void {
    for (const link of this.links) { this.group.remove(link.cord.mesh); link.cord.dispose(); }
    this.links.length = 0;
  }
  dispose(): void { this.clear(); this.material.dispose(); }
}
