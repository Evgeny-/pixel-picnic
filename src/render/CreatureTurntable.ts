import * as THREE from 'three';
import { CREATURES, type CreatureId } from '../core/creatures';
import { creatureModel } from './creatureModel';
import type { HatId } from './hats';
import './creatureTurntable.css';

const VIEW = new THREE.Vector3(0.35, 0.45, 0.82).normalize();
const START_YAW = 0.55;
const RADIANS_PER_SECOND = 0.46;


/** Centre the turn on the silhouette's footprint, keeping the feet at their original height. */
export function centeredTurntableModel(model: THREE.Group): THREE.Group {
  const center = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  const pivot = new THREE.Group();
  model.position.x -= center.x;
  model.position.z -= center.z;
  pivot.add(model);
  return pivot;
}

/**
 * Frame the complete vertical rotation envelope, so tails and hats never leave the card and
 * the camera does not zoom or bob as the animal turns. Rotation stays around its natural Y axis.
 */
export function frameTurntable(camera: THREE.OrthographicCamera, model: THREE.Object3D, aspect: number): void {
  const point = new THREE.Vector3();
  const sin = VIEW.y;
  const cos = Math.hypot(VIEW.x, VIEW.z);
  let radius = 0;
  let bottom = Infinity;
  let top = -Infinity;
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const positions = child.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld);
      const r = Math.hypot(point.x, point.z);
      radius = Math.max(radius, r);
      bottom = Math.min(bottom, point.y * cos - r * sin);
      top = Math.max(top, point.y * cos + r * sin);
    }
  });
  if (!Number.isFinite(bottom)) return;
  const safeAspect = Math.max(0.1, aspect);
  const halfHeight = Math.max((top - bottom) / 2, radius / safeAspect) * 1.10;
  const target = new THREE.Vector3(0, (bottom + top) / (2 * cos), 0);
  camera.left = -halfHeight * safeAspect;
  camera.right = halfHeight * safeAspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.position.copy(target).addScaledVector(VIEW, 6 + radius * 2);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function disposeModel(model: THREE.Object3D): void {
  // Every leg shares one geometry/material; release each resource once.
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

/**
 * One live canvas per picker or shop. Move it between preview wrappers with set(); static images
 * remain underneath as the fallback. The canvas ignores pointer events, so selecting a card and
 * scrolling a touch dialog keep their normal behaviour without accidental drag/purchase clicks.
 */
export class CreatureTurntable {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  private model: THREE.Group | null = null;
  private modelKey = '';
  private host: HTMLElement | null = null;
  private frame = 0;
  private lastTime = 0;
  private width = 0;
  private height = 0;
  private inView = true;
  private lost = false;
  private disposed = false;
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly resizeObserver = new ResizeObserver(() => this.resume());
  private readonly intersectionObserver = new IntersectionObserver((entries) => {
    const entry = entries.find((item) => item.target === this.host);
    if (!entry) return;
    this.inView = entry.isIntersecting;
    if (this.inView) this.resume();
    else this.stop();
  });

  constructor() {
    this.scene.add(new THREE.HemisphereLight('#fffaf0', '#8a7a6a', 1.4));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(-2, 4, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#e4eaff', 0.65);
    rim.position.set(2, 2, -3);
    this.scene.add(rim);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.motion.addEventListener('change', this.visibilityChanged);
  }

  /** host must be a preview-sized wrapper; its static <img> keeps the layout and fallback. */
  set(creature: CreatureId, hat: HatId, host: HTMLElement): void {
    if (this.disposed) return;
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      } catch {
        // A device with no spare WebGL context can still display the cached portrait.
        return;
      }
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NeutralToneMapping;
      this.renderer.setClearColor(0x000000, 0);
      const canvas = this.renderer.domElement;
      canvas.className = 'creature-turntable-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.addEventListener('webglcontextlost', this.contextLost);
      canvas.addEventListener('webglcontextrestored', this.contextRestored);
    }
    if (this.host !== host) {
      this.hide();
      this.host = host;
      this.inView = true;
      host.classList.add('creature-turntable-host');
      host.append(this.renderer.domElement);
      this.resizeObserver.observe(host);
      this.intersectionObserver.observe(host);
    }
    const key = `${creature}:${hat}`;
    if (key !== this.modelKey) {
      if (this.model) {
        this.scene.remove(this.model);
        disposeModel(this.model);
      }
      const color = CREATURES.find((item) => item.id === creature)!.color;
      this.model = centeredTurntableModel(creatureModel(creature, color, hat));
      this.model.rotation.y = START_YAW;
      this.modelKey = key;
      this.scene.add(this.model);
      this.width = this.height = 0;
      this.lastTime = 0;
    }
    this.resume();
  }

  /** Pause and return the old card to its still portrait. Retains the one reusable renderer. */
  hide(): void {
    this.stop();
    if (this.host) {
      this.host.classList.remove('creature-turntable-host', 'creature-turntable-active');
      this.resizeObserver.unobserve(this.host);
      this.intersectionObserver.unobserve(this.host);
    }
    this.renderer?.domElement.remove();
    this.host = null;
    this.width = this.height = 0;
  }

  private canRender(): boolean {
    return !!this.host?.isConnected && !!this.renderer && !!this.model && !this.disposed && !this.lost &&
      this.inView && document.visibilityState !== 'hidden' &&
      this.host.clientWidth > 0 && this.host.clientHeight > 0 && getComputedStyle(this.host).visibility !== 'hidden';
  }

  private resize(): void {
    const width = Math.round(this.host!.clientWidth);
    const height = Math.round(this.host!.clientHeight);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer!.setSize(width, height, false);
    frameTurntable(this.camera, this.model!, width / height);
  }

  private resume(): void {
    if (!this.canRender()) { this.stop(); return; }
    this.resize();
    this.renderer!.render(this.scene, this.camera);
    this.host!.classList.add('creature-turntable-active');
    if (!this.frame && !this.motion.matches) this.frame = requestAnimationFrame(this.animate);
  }

  private stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
  }

  private readonly animate = (time: number): void => {
    this.frame = 0;
    if (!this.canRender()) { this.stop(); return; }
    if (this.lastTime) this.model!.rotation.y += Math.min(0.05, (time - this.lastTime) / 1000) * RADIANS_PER_SECOND;
    this.lastTime = time;
    this.resize();
    this.renderer!.render(this.scene, this.camera);
    if (!this.motion.matches) this.frame = requestAnimationFrame(this.animate);
    else this.lastTime = 0;
  };

  private readonly visibilityChanged = (): void => {
    this.stop();
    this.resume();
  };

  private readonly contextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.stop();
    this.host?.classList.remove('creature-turntable-active');
  };

  private readonly contextRestored = (): void => {
    this.lost = false;
    this.width = this.height = 0;
    this.resume();
  };

  dispose(): void {
    if (this.disposed) return;
    this.hide();
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.motion.removeEventListener('change', this.visibilityChanged);
    if (this.model) disposeModel(this.model);
    this.model = null;
    this.scene.clear();
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener('webglcontextlost', this.contextLost);
      canvas.removeEventListener('webglcontextrestored', this.contextRestored);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
  }
}
