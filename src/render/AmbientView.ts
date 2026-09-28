import * as THREE from 'three';
import type { Layout } from './layout';
import type { GroundKind, WorldTheme } from './themes';
import { radialTexture, sparkleTexture } from './textures';

interface Mote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
  rot: number;
  spin: number;
  size: number;
  rest: number;
  color: THREE.Color;
}

type Style = {
  count: number;
  tex: 'glow' | 'leaf' | 'sprinkle' | 'flake' | 'sparkle';
  colors: string[];
  size: [number, number];
  fall: [number, number];
  additive: boolean;
  opacity: number;
  blink?: boolean;
};

const STYLES: Record<GroundKind, Style> = {
  paving: { count: 20, tex: 'glow', colors: ['#fff9e8', '#ffffff'], size: [0.07, 0.12], fall: [-0.02, 0.03], additive: true, opacity: 0.55 },
  planks: { count: 18, tex: 'glow', colors: ['#fff5df', '#fffce9'], size: [0.06, 0.1], fall: [-0.025, 0.025], additive: true, opacity: 0.45 },
  clouds: { count: 24, tex: 'sparkle', colors: ['#ffffff', '#f5e5ba'], size: [0.1, 0.18], fall: [-0.035, 0.035], additive: true, opacity: 0.55, blink: true },
  grass: { count: 46, tex: 'glow', colors: ['#fffbe6', '#fff4b8', '#ffffff'], size: [0.08, 0.16], fall: [-0.06, 0.06], additive: true, opacity: 0.9 },
  forest: { count: 26, tex: 'leaf', colors: ['#e0703a', '#f2b84b', '#c9502e', '#a7c957', '#d98c2b'], size: [0.28, 0.42], fall: [-0.45, -0.25], additive: false, opacity: 1 },
  sand: { count: 34, tex: 'sparkle', colors: ['#ffffff', '#fff6d8', '#d6f6ff'], size: [0.14, 0.26], fall: [-0.02, 0.04], additive: true, opacity: 0.85, blink: true },
  frosting: { count: 40, tex: 'sprinkle', colors: ['#ff5d8f', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#ffffff'], size: [0.16, 0.22], fall: [-0.55, -0.3], additive: false, opacity: 1 },
  night: { count: 44, tex: 'glow', colors: ['#fff7a8', '#d9ff8a', '#a8fff0'], size: [0.14, 0.24], fall: [-0.05, 0.05], additive: true, opacity: 1, blink: true },
  snow: { count: 70, tex: 'flake', colors: ['#ffffff', '#f2f9ff'], size: [0.1, 0.2], fall: [-0.5, -0.28], additive: false, opacity: 0.95 },
  magic: { count: 46, tex: 'sparkle', colors: ['#fff3b0', '#ffc6ff', '#bdf4ff', '#ffffff'], size: [0.14, 0.28], fall: [0.05, 0.18], additive: true, opacity: 0.95, blink: true },
};

function canvasTex(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 64): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const TEX: Record<Style['tex'], () => THREE.Texture> = {
  glow: () => radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64),
  sparkle: () => sparkleTexture(64),
  leaf: () =>
    canvasTex((g, s) => {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(s * 0.08, s * 0.5);
      g.quadraticCurveTo(s * 0.5, s * 0.02, s * 0.92, s * 0.5);
      g.quadraticCurveTo(s * 0.5, s * 0.98, s * 0.08, s * 0.5);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = s * 0.04;
      g.beginPath();
      g.moveTo(s * 0.1, s * 0.5);
      g.lineTo(s * 0.9, s * 0.5);
      g.stroke();
    }),
  sprinkle: () =>
    canvasTex((g, s) => {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.roundRect(s * 0.1, s * 0.36, s * 0.8, s * 0.28, s * 0.14);
      g.fill();
    }),
  flake: () =>
    canvasTex((g, s) => {
      const m = s / 2;
      const grad = g.createRadialGradient(m, m, 0, m, m, m);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(m, m, m, 0, Math.PI * 2);
      g.fill();
    }),
};

/** Gentle ambient life above the ground: pollen, leaves, fireflies, snow… per world. */
export class AmbientView {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private motes: Mote[] = [];
  private style: Style = STYLES.grass;
  private box = { x0: -10, x1: 10, z0: -10, z1: 10 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qz = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly tmpC = new THREE.Color();
  private readonly e = new THREE.Euler();

  private night = false;
  private baseOpacity = 1;

  /** Night mode: particles fade to a soft glimmer. */
  setNight(on: boolean): void {
    this.night = on;
    const mat = this.mesh?.material as THREE.MeshBasicMaterial | undefined;
    if (mat) mat.opacity = this.baseOpacity * (on ? 0.6 : 1);
  }

  setTheme(theme: WorldTheme): void {
    this.dispose();
    this.style = STYLES[theme.ground.kind];
    const st = this.style;
    const mat = new THREE.MeshBasicMaterial({
      map: TEX[st.tex](),
      transparent: true,
      depthWrite: false,
      opacity: st.opacity,
      side: THREE.DoubleSide,
      blending: st.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.baseOpacity = st.opacity;
    mat.opacity = st.opacity * (this.night ? 0.6 : 1);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, st.count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.group.add(this.mesh);
    this.motes = [];
    for (let i = 0; i < st.count; i++) this.motes.push(this.spawn(true));
  }

  setLayout(l: Layout): void {
    const b = l.bounds;
    this.box = { x0: b.minX - 3, x1: b.maxX + 3, z0: b.minZ - 3, z1: b.maxZ + 3 };
  }

  private spawn(anywhere: boolean): Mote {
    const st = this.style;
    const b = this.box;
    const falling = st.fall[1] < -0.1;
    const rising = st.fall[0] > 0;
    return {
      x: b.x0 + Math.random() * (b.x1 - b.x0),
      y: anywhere ? 0.3 + Math.random() * 5 : falling ? 5 + Math.random() * 1.5 : rising ? 0.2 : 0.3 + Math.random() * 5,
      z: b.z0 + Math.random() * (b.z1 - b.z0),
      vx: (Math.random() - 0.5) * 0.3,
      vy: st.fall[0] + Math.random() * (st.fall[1] - st.fall[0]),
      vz: (Math.random() - 0.5) * 0.2,
      phase: Math.random() * 10,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 3,
      size: st.size[0] + Math.random() * (st.size[1] - st.size[0]),
      rest: 0,
      color: new THREE.Color(st.colors[Math.floor(Math.random() * st.colors.length)]),
    };
  }

  update(dt: number, time: number, camera: THREE.Camera): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const st = this.style;
    const b = this.box;
    const wind = Math.sin(time * 0.3) * 0.25;
    for (let i = 0; i < this.motes.length; i++) {
      let p = this.motes[i];
      p.phase += dt;
      if (p.rest > 0) {
        p.rest -= dt;
        if (p.rest <= 0) p = this.motes[i] = this.spawn(false);
      } else {
        p.x += (p.vx + wind + Math.sin(p.phase * 1.3) * 0.25) * dt;
        p.z += (p.vz + Math.cos(p.phase * 0.9) * 0.15) * dt;
        p.y += (p.vy + Math.sin(p.phase * 2.1) * 0.08) * dt;
        p.rot += p.spin * dt;
        if (p.y < 0.04) {
          p.y = 0.04;
          p.rest = 3 + Math.random() * 3; // lie on the ground for a while
        }
        if (p.y > 7 || p.x < b.x0 - 1 || p.x > b.x1 + 1 || p.z < b.z0 - 1 || p.z > b.z1 + 1) p = this.motes[i] = this.spawn(false);
      }
      let k = st.blink ? 0.55 + 0.45 * Math.sin(p.phase * 3 + i) : 1;
      if (p.rest > 0) k *= Math.min(1, p.rest / 1.5);
      this.v.set(p.x, p.y, p.z);
      if (p.rest > 0 && (st.tex === 'leaf' || st.tex === 'sprinkle')) {
        this.q.setFromEuler(this.e.set(-Math.PI / 2, 0, p.rot));
      } else {
        this.q.copy(camera.quaternion).multiply(this.qz.setFromAxisAngle(this.zAxis, p.rot));
      }
      const sz = p.size * (st.tex === 'glow' || st.tex === 'sparkle' ? k : 1);
      this.s.set(sz, sz, sz);
      this.m.compose(this.v, this.q, this.s);
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, this.tmpC.copy(p.color).multiplyScalar(st.additive ? k : 1));
    }
    mesh.count = this.motes.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
    this.mesh.dispose();
    this.mesh = null;
  }
}
