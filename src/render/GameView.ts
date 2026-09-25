import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Sim, SimEvent } from '../core/sim';
import type { LevelDef } from '../core/types';
import { BoardView } from './BoardView';
import { QueueView } from './QueueView';
import { AntsView } from './AntsView';
import { NestView } from './NestView';
import { FxView } from './FxView';
import { computeLayout, type Layout } from './layout';
import { GroundView } from './GroundView';
import { AmbientView } from './AmbientView';
import type { WorldTheme } from './themes';

/** Phones/tablets get a lighter render path (pixel ratio, shadow map, fewer shadow casters). */
export const LOW_END =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || (navigator.hardwareConcurrency ?? 8) <= 4);

export interface ViewCallbacks {
  onPick(cell: number): void;
  onDeliver(): void;
}

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Owns the three.js renderer and every visual element of a level.
 * The simulation is the source of truth; the view animates towards it.
 */
export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  board!: BoardView;
  queue!: QueueView;
  ants!: AntsView;
  nest!: NestView;
  fx = new FxView();
  ambient = new AmbientView();
  ground: GroundView;
  layout!: Layout;
  private sim!: Sim;
  level!: LevelDef;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private cb: ViewCallbacks;
  private width = 1;
  private height = 1;
  insets: Insets = { top: 70, bottom: 110, left: 0, right: 0 };
  private tmp = new THREE.Vector3();
  private levelGroup = new THREE.Group();
  private zoomPunch = 0;

  constructor(container: HTMLElement, cb: ViewCallbacks) {
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW_END ? 1.6 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('gl');

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight('#fffaf0', '#7a8f6a', 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(LOW_END ? 1024 : 2048, LOW_END ? 1024 : 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ground = new GroundView();
    this.scene.add(this.ground.group);
    this.scene.add(this.levelGroup);
    this.scene.add(this.fx.group);
    this.scene.add(this.ambient.group);
  }

  load(level: LevelDef, sim: Sim, theme: WorldTheme): void {
    this.unload();
    this.level = level;
    this.sim = sim;
    const palette = level.picture.palette;
    this.board = new BoardView(sim, palette, theme.frame);
    this.board.cubes.castShadow = !LOW_END;
    this.queue = new QueueView(sim, palette);
    this.nest = new NestView(theme.soil);
    this.ants = new AntsView(palette, this.board, this.cb);
    this.levelGroup.add(this.board.group, this.queue.group, this.nest.group, this.ants.group);
    this.hemi.color.set(theme.sky);
    this.hemi.groundColor.set(theme.bounce);
    this.scene.background = new THREE.Color(theme.bg);
    this.ground.setTheme(theme);
    this.ambient.setTheme(theme);
    this.relayout(true);
  }

  /** Swap the simulation instance (undo / shuffle restore a snapshot). */
  setSim(sim: Sim): void {
    this.sim = sim;
    this.queue.setSim(sim);
  }

  unload(): void {
    if (!this.board) return;
    this.levelGroup.clear();
    this.board.dispose();
    this.queue.dispose();
    this.ants.dispose();
    this.nest.dispose();
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    if (this.sim) this.relayout(false);
  }

  /** Recompute positions (screen rotation, extra slot). */
  relayout(force: boolean): void {
    const freeW = Math.max(100, this.width - this.insets.left - this.insets.right);
    const freeH = Math.max(100, this.height - this.insets.top - this.insets.bottom);
    const l = computeLayout({
      aspect: freeW / freeH,
      w: this.sim.w,
      h: this.sim.h,
      slots: this.sim.slots.length,
      columns: this.sim.columns.length,
    });
    const changed = force || !this.layout || l.mode !== this.layout.mode || l.slot.length !== this.layout.slot.length;
    this.layout = l;
    if (changed) {
      this.board.setLayout(l);
      this.queue.setLayout(l);
      this.nest.setLayout(l);
      this.ants.setLayout(l);
    }
    this.fitCamera(freeW, freeH);
    this.ground.setLayout(l);
    this.ambient.setLayout(l);
  }

  private fitCamera(freeW: number, freeH: number): void {
    const l = this.layout;
    const b = l.bounds;
    const cos = Math.cos(l.tilt);
    const sin = Math.sin(l.tilt);
    const needW = b.maxX - b.minX;
    const needH = (b.maxZ - b.minZ) * cos + 0.8 * sin;
    const upp = Math.max(needW / freeW, needH / freeH) * 1.02; // world units per pixel
    const halfW = (this.width * upp) / 2;
    const halfH = (this.height * upp) / 2;
    // Center of the content on the ground, then shift so it lands in the middle of the free area.
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const dist = 60;
    this.camera.position.set(cx, dist * cos, cz + dist * sin);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(cx, 0, cz);
    const shiftY = ((this.insets.bottom - this.insets.top) / 2) * upp;
    const shiftX = ((this.insets.right - this.insets.left) / 2) * upp;
    this.camera.left = -halfW + shiftX;
    this.camera.right = halfW + shiftX;
    this.camera.top = halfH + shiftY;
    this.camera.bottom = -halfH + shiftY;
    this.camera.near = 1;
    this.camera.far = dist * 2 + 20;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.fx.setCamera(this.camera);

    // Sun: from the upper left, shadow frustum around the content.
    const span = Math.max(needW, b.maxZ - b.minZ) * 0.75 + 2;
    this.sun.position.set(cx - 8, 22, cz - 10);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = 60;
    sc.updateProjectionMatrix();
  }

  /** Box id under a screen point (CSS pixels relative to the canvas). */
  pickBox(x: number, y: number): number | null {
    this.ndc.set((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.queue.group.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.queue.pick(this.raycaster);
  }

  /** Project a world point to CSS pixels. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = this.tmp.copy(p).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  /** React to simulation events (after the sim already changed). */
  apply(events: SimEvent[]): void {
    let queueChanged = false;
    for (const e of events) {
      switch (e.t) {
        case 'ant': {
          const from = this.queue.boxTop(e.box, this.tmp);
          this.ants.spawn(from.clone(), e.cell, e.side, e.color);
          break;
        }
        case 'take':
        case 'boxDone':
        case 'reveal':
        case 'thaw':
          queueChanged = true;
          break;
      }
    }
    if (queueChanged) this.queue.syncFromSim(true);
    else this.queue.refreshLabels();
  }

  punch(): void {
    this.zoomPunch = 1;
  }

  update(dt: number, time: number): void {
    if (!this.board) return;
    this.board.update(dt);
    this.queue.update(dt, time);
    this.ants.update(dt, time);
    this.nest.update(dt);
    this.fx.update(dt);
    this.ground.update(dt, time);
    this.ambient.update(dt, time, this.camera);
    if (this.zoomPunch > 0) {
      this.zoomPunch = Math.max(0, this.zoomPunch - dt * 2.5);
      this.camera.zoom = 1 + Math.sin(this.zoomPunch * Math.PI) * 0.015;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** True when nothing is moving any more (ants home, boxes settled). */
  isIdle(): boolean {
    return this.ants.count === 0 && this.queue.isSettled();
  }

  dispose(): void {
    this.unload();
    this.fx.dispose();
    this.ambient.dispose();
    this.ground.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
