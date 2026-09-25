import * as THREE from 'three';
import type { Layout } from './layout';
import type { WorldTheme } from './themes';
import { paintGround } from './groundPainter';
import { radialTexture } from './textures';

const TILE = 11;
const cache = new Map<string, THREE.CanvasTexture>();

/** Ground plane with a painted seamless texture plus slowly drifting sun dapples. */
export class GroundView {
  readonly group = new THREE.Group();
  private plane: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private dapples: THREE.Mesh[] = [];
  private dappleMat: THREE.MeshBasicMaterial;
  private center = new THREE.Vector2();

  constructor() {
    this.mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.25 });
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), this.mat);
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.receiveShadow = true;
    this.group.add(this.plane);
    this.dappleMat = new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(255,250,220,1)', 'rgba(255,250,220,0)', 128),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.dappleMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.01;
      m.userData = { ph: Math.random() * 10, r: 3 + Math.random() * 4, sp: 0.05 + Math.random() * 0.07, ox: (Math.random() - 0.5) * 22, oz: (Math.random() - 0.5) * 22 };
      this.dapples.push(m);
      this.group.add(m);
    }
  }

  setTheme(theme: WorldTheme): void {
    let tex = cache.get(theme.id);
    if (!tex) {
      tex = new THREE.CanvasTexture(paintGround(theme, 1024, theme.id.length * 31 + 5));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      tex.repeat.set(160 / TILE, 160 / TILE);
      cache.set(theme.id, tex);
    }
    this.mat.map = tex;
    this.mat.needsUpdate = true;
    const night = theme.ground.kind === 'night';
    this.dappleMat.opacity = night ? 0.06 : theme.ground.kind === 'snow' ? 0.1 : 0.16;
  }

  setLayout(l: Layout): void {
    this.center.set((l.bounds.minX + l.bounds.maxX) / 2, (l.bounds.minZ + l.bounds.maxZ) / 2);
  }

  update(_dt: number, time: number): void {
    for (const d of this.dapples) {
      const u = d.userData as { ph: number; r: number; sp: number; ox: number; oz: number };
      const t = time * u.sp + u.ph;
      d.position.x = this.center.x + u.ox + Math.sin(t) * 2.5;
      d.position.z = this.center.y + u.oz + Math.cos(t * 0.8) * 2;
      const s = u.r * (1 + Math.sin(t * 2.3) * 0.12);
      d.scale.set(s, s, 1);
    }
  }

  dispose(): void {
    this.plane.geometry.dispose();
    this.mat.dispose();
    this.dappleMat.map?.dispose();
    this.dappleMat.dispose();
    for (const d of this.dapples) d.geometry.dispose();
  }
}
