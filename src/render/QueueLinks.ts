import * as THREE from 'three';
import type { Sim } from '../core/sim';
import { BOX_H } from './boxStyle';
import type { Layout } from './layout';
import { hiddenChainEnd, linkedTargets, routeChain, type ChainPoint, type LinkedEndpoint } from './chainRouting';

interface LinkBox {
  group: THREE.Group;
  to: THREE.Vector3;
  where: 'queue' | 'slot' | 'gone';
  fade: number;
}
interface LinkEnd extends ChainPoint { box?: number }
interface LinkVis {
  chain: THREE.InstancedMesh;
  a: LinkEnd;
  b: LinkEnd;
  route: ChainPoint[];
  distances: number[];
  points: Float64Array;
  lengths: Float64Array;
  last: Float64Array;
}
const CHAIN_MAX = 144;
const AXIS_X = new THREE.Vector3(1, 0, 0);

/** Physical gold links follow the gaps between boxes, including partners below the visible rows. */
export class QueueLinks {
  private readonly links = new Map<string, LinkVis>();
  private cacheKey = '';
  private readonly linkMat = new THREE.MeshStandardMaterial({ color: '#e0b04a', roughness: 0.28, metalness: 0.85, envMapIntensity: 1.4 });
  private readonly linkGeo = new THREE.TorusGeometry(0.075, 0.024, 4, 10);
  private readonly rotation = new THREE.Quaternion();
  private readonly twist = new THREE.Quaternion();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(_sim: Sim, private readonly boxes: ReadonlyMap<number, LinkBox>, private readonly group: THREE.Group) {}

  sync(sim: Sim, layout: Layout, columnX: (column: number) => number): void {
    const targets = linkedTargets(sim, layout.queueRowsVisible);
    const visible = new Set<number>();
    for (const [id, box] of this.boxes) {
      if (box.where === 'slot' || (box.where === 'queue' && sim.columns[sim.boxCol[id]]?.indexOf(id) < layout.queueRowsVisible)) visible.add(id);
    }
    const obstacles = [...visible].map((id) => {
      const p = this.boxes.get(id)!.to;
      return { id, x: p.x, z: p.z, half: layout.boxSize * 0.5 };
    });
    const endpoint = (end: LinkedEndpoint, other: LinkedEndpoint): LinkEnd => {
      if (end.visible) {
        const p = this.boxes.get(end.box)!.to;
        return { box: end.box, x: p.x, z: p.z };
      }
      const otherX = other.visible ? this.boxes.get(other.box)!.to.x : columnX(other.column);
      return hiddenChainEnd(layout, columnX(end.column), otherX);
    };
    const plans = targets.map(({ a, b }) => ({ key: `${a.box}:${b.box}`, a: endpoint(a, b), b: endpoint(b, a) }));
    // sync also runs after each ant round. Plan only from settled targets, never from animated positions.
    const key = JSON.stringify([layout.boxSize, obstacles, plans]);
    if (key === this.cacheKey) return;
    this.cacheKey = key;
    for (const link of this.links.values()) link.chain.visible = false;
    for (const plan of plans) {
      let link = this.links.get(plan.key);
      if (!link) {
        const chain = new THREE.InstancedMesh(this.linkGeo, this.linkMat, CHAIN_MAX);
        chain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        chain.castShadow = true;
        chain.frustumCulled = false;
        this.group.add(chain);
        link = { chain, a: plan.a, b: plan.b, route: [], distances: [], points: new Float64Array(0), lengths: new Float64Array(0), last: new Float64Array(8).fill(NaN) };
        this.links.set(plan.key, link);
      }
      link.a = plan.a;
      link.b = plan.b;
      link.route = routeChain(plan.a, plan.b, obstacles, layout.boxSize * 0.12);
      let distance = 0;
      link.distances = link.route.map((p, i, route) => {
        if (i) distance += Math.hypot(p.x - route[i - 1].x, p.z - route[i - 1].z);
        return distance;
      });
      link.points = new Float64Array(link.route.length * 3);
      link.lengths = new Float64Array(link.route.length);
      link.last.fill(NaN);
    }
    const active = new Set(plans.map((plan) => plan.key));
    for (const [id, link] of this.links) if (!active.has(id)) {
      this.group.remove(link.chain);
      link.chain.dispose();
      this.links.delete(id);
    }
  }

  update(size: number): void {
    for (const link of this.links.values()) this.updateChain(link, size);
  }

  private updateChain(link: LinkVis, s: number): void {
    const a = link.a.box === undefined ? undefined : this.boxes.get(link.a.box);
    const b = link.b.box === undefined ? undefined : this.boxes.get(link.b.box);
    const visible = (box: LinkBox | undefined) => !box || (box.group.visible && box.where !== 'gone' && box.fade > 0.3);
    link.chain.visible = link.route.length > 1 && visible(a) && visible(b);
    if (!link.chain.visible) return;
    const ax = a ? a.group.position.x - link.a.x : 0;
    const az = a ? a.group.position.z - link.a.z : 0;
    const bx = b ? b.group.position.x - link.b.x : 0;
    const bz = b ? b.group.position.z - link.b.z : 0;
    const ay = a ? a.group.position.y + BOX_H * s * 0.55 : s * 0.10;
    const by = b ? b.group.position.y + BOX_H * s * 0.55 : s * 0.10;
    const last = link.last;
    if (last[0] === ax && last[1] === az && last[2] === bx && last[3] === bz && last[4] === ay && last[5] === by && last[6] === s) return;
    last[0] = ax; last[1] = az; last[2] = bx; last[3] = bz; last[4] = ay; last[5] = by; last[6] = s;
    const total = link.distances.at(-1)!;
    let length = 0;
    for (let i = 0; i < link.route.length; i++) {
      const p = link.route[i], t = total ? link.distances[i] / total : 0;
      const k = i * 3;
      link.points[k] = p.x + ax * (1 - t) + bx * t;
      link.points[k + 1] = ay * (1 - t) + by * t;
      link.points[k + 2] = p.z + az * (1 - t) + bz * t;
      if (i) length += Math.hypot(link.points[k] - link.points[k - 3], link.points[k + 1] - link.points[k - 2], link.points[k + 2] - link.points[k - 1]);
      link.lengths[i] = length;
    }
    const n = Math.max(2, Math.min(CHAIN_MAX, Math.round(length / (0.13 * s)) + 1));
    this.scale.set(1.45 * s, s, s);
    let segment = 1;
    for (let i = 0; i < n; i++) {
      const progress = i / (n - 1), d = progress * length;
      while (segment + 1 < link.route.length && link.lengths[segment] < d) segment++;
      const k = segment * 3, p = link.points;
      const segmentLength = link.lengths[segment] - link.lengths[segment - 1];
      const t = segmentLength ? (d - link.lengths[segment - 1]) / segmentLength : 0;
      this.position.set(p[k - 3] + (p[k] - p[k - 3]) * t, p[k - 2] + (p[k + 1] - p[k - 2]) * t,
        p[k - 1] + (p[k + 2] - p[k - 1]) * t);
      this.position.y -= Math.sin(progress * Math.PI) * Math.min(s * 0.10, length * 0.18);
      this.direction.set(p[k] - p[k - 3], p[k + 1] - p[k - 2], p[k + 2] - p[k - 1]).normalize();
      this.rotation.setFromUnitVectors(AXIS_X, this.direction);
      this.twist.setFromAxisAngle(AXIS_X, i % 2 ? Math.PI / 2 : 0).premultiply(this.rotation);
      this.matrix.compose(this.position, this.twist, this.scale);
      link.chain.setMatrixAt(i, this.matrix);
    }
    link.chain.count = n;
    link.chain.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const link of this.links.values()) {
      this.group.remove(link.chain);
      link.chain.dispose();
    }
    this.links.clear();
    this.linkMat.dispose();
    this.linkGeo.dispose();
  }
}
