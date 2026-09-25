import * as THREE from 'three';
import type { Layout } from './layout';
import { radialTexture } from './textures';

/** Deterministic pseudo random numbers so the nest looks the same every time. */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The ant hill: a low crater of loose soil around a dark tunnel entrance, covered in grains
 * the ants have carried out, with a few pebbles and a fallen leaf around it.
 */
export class NestView {
  readonly group = new THREE.Group();
  /** Everything that squashes when an ant dives in. */
  private body = new THREE.Group();
  private mound: THREE.Mesh;
  private grains: THREE.InstancedMesh;
  private pebbles: THREE.InstancedMesh;
  private leaf: THREE.Mesh;
  private twig: THREE.Mesh;
  private hole: THREE.Mesh;
  private pulse = 0;

  constructor(color = '#a8764c') {
    const soil = new THREE.Color(color);
    const deep = new THREE.Color('#1f120a');

    // Crater profile (radius, height): gentle outer slope, a rounded rim, a funnel into the tunnel.
    const prof: [number, number][] = [
      [1.08, 0], [0.98, 0.035], [0.86, 0.09], [0.74, 0.15], [0.63, 0.2], [0.55, 0.225], [0.49, 0.225],
      [0.43, 0.2], [0.37, 0.15], [0.31, 0.1], [0.26, 0.06], [0.21, 0.035], [0.12, 0.022], [0.001, 0.02],
    ];
    const geo = new THREE.LatheGeometry(
      prof.map(([r, y]) => new THREE.Vector2(r, y)),
      56,
    );
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      // Lumpy, slightly irregular outline.
      const n = 1 + Math.sin(a * 5 + 0.4) * 0.045 + Math.sin(a * 9 + 1.3) * 0.03 + Math.sin(a * 17) * 0.012;
      pos.setX(i, x * n);
      pos.setZ(i, z * n);
      pos.setY(i, r < 0.3 ? y : y * (1 + Math.sin(a * 7 + 2) * 0.12));
      // Darker towards the tunnel, a little lighter on the sunny rim.
      const inside = r < 0.49 ? THREE.MathUtils.smoothstep(0.49 - r, 0, 0.26) : 0;
      c.copy(soil).offsetHSL(0, 0, (hash(i) - 0.5) * 0.04 + (r > 0.45 && r < 0.62 ? 0.04 : 0));
      c.lerp(deep, Math.min(1, inside * 1.1));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.mound = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, side: THREE.DoubleSide }));
    this.mound.castShadow = true;
    this.mound.receiveShadow = true;
    this.body.add(this.mound);

    // The tunnel itself: a dark opening at the bottom of the funnel.
    const holeTex = radialTexture('rgba(8,4,2,1)', 'rgba(31,18,10,0)', 128);
    this.hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 32),
      new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false }),
    );
    this.hole.rotation.x = -Math.PI / 2;
    this.hole.position.y = 0.03;
    this.hole.renderOrder = 2;
    this.body.add(this.hole);

    // Grains of soil scattered over the slope (what the ants dug out).
    const grainCount = 150;
    this.grains = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.045, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      grainCount,
    );
    this.grains.castShadow = true;
    this.grains.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const heightAt = (r: number): number => {
      for (let k = 1; k < prof.length; k++) {
        const [r0, y0] = prof[k - 1];
        const [r1, y1] = prof[k];
        if (r <= r0 && r >= r1) return y0 + ((r0 - r) / (r0 - r1)) * (y1 - y0);
      }
      return 0;
    };
    for (let i = 0; i < grainCount; i++) {
      const a = hash(i * 3 + 1) * Math.PI * 2;
      const r = 0.47 + Math.pow(hash(i * 3 + 2), 0.8) * 0.66;
      const size = 0.55 + hash(i * 3 + 3) * 0.9;
      v.set(Math.cos(a) * r, heightAt(Math.min(1.08, r)) + 0.015, Math.sin(a) * r);
      e.set(hash(i + 7) * 3, hash(i + 11) * 3, hash(i + 13) * 3);
      q.setFromEuler(e);
      s.set(size, size * 0.75, size);
      this.grains.setMatrixAt(i, m.compose(v, q, s));
      c.copy(soil).offsetHSL((hash(i + 5) - 0.5) * 0.02, 0.02, (hash(i + 9) - 0.45) * 0.16);
      this.grains.setColorAt(i, c);
    }
    this.body.add(this.grains);

    // Pebbles around the foot of the hill.
    const pebbleCount = 9;
    this.pebbles = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.09, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.75 }),
      pebbleCount,
    );
    this.pebbles.castShadow = true;
    this.pebbles.receiveShadow = true;
    for (let i = 0; i < pebbleCount; i++) {
      const a = (i / pebbleCount) * Math.PI * 2 + hash(i + 40) * 0.5;
      // Keep the front (towards the camera) clear so the tunnel stays visible.
      const r = 1.12 + hash(i + 50) * 0.25;
      const size = 0.6 + hash(i + 60) * 0.8;
      v.set(Math.cos(a) * r, 0.03 * size, Math.sin(a) * r * 0.9);
      e.set(hash(i + 70) * 2, hash(i + 80) * 3, 0);
      q.setFromEuler(e);
      s.set(size * 1.2, size * 0.6, size);
      this.pebbles.setMatrixAt(i, m.compose(v, q, s));
      c.set('#b9a58e').offsetHSL(0, -0.05, (hash(i + 90) - 0.5) * 0.18);
      this.pebbles.setColorAt(i, c);
    }
    this.group.add(this.pebbles);

    // A fallen leaf and a twig: small props that make the hill feel lived in.
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, -0.26);
    leafShape.quadraticCurveTo(0.2, -0.08, 0, 0.26);
    leafShape.quadraticCurveTo(-0.2, -0.08, 0, -0.26);
    const leafGeo = new THREE.ShapeGeometry(leafShape, 10);
    leafGeo.rotateX(-Math.PI / 2);
    const lp = leafGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) lp.setY(i, Math.abs(lp.getX(i)) * 0.25 + 0.012);
    leafGeo.computeVertexNormals();
    this.leaf = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({ color: '#8bc34a', roughness: 0.6, side: THREE.DoubleSide }));
    // Lying on the slope of the hill, where it stands out against the soil.
    this.leaf.position.set(-0.7, 0.2, 0.28);
    this.leaf.rotation.set(0.25, 0.7, 0.32);
    this.leaf.castShadow = true;
    this.leaf.receiveShadow = true;
    this.group.add(this.leaf);

    const twigGeo = new THREE.CylinderGeometry(0.018, 0.024, 0.62, 6);
    twigGeo.rotateZ(Math.PI / 2);
    this.twig = new THREE.Mesh(twigGeo, new THREE.MeshStandardMaterial({ color: '#8d6e52', roughness: 0.9 }));
    this.twig.position.set(0.95, 0.03, -0.45);
    this.twig.rotation.y = -0.6;
    this.twig.castShadow = true;
    this.group.add(this.twig);

    this.group.add(this.body);
  }

  setLayout(l: Layout): void {
    this.group.position.set(l.nest.x, 0, l.nest.z);
    const s = l.mode === 'portrait' ? 0.82 : 0.95;
    this.group.scale.set(s, s, s * 0.88);
  }

  /** Squash a little when an ant goes in. */
  gulp(): void {
    this.pulse = Math.min(1, this.pulse + 0.25);
  }

  update(dt: number): void {
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3);
    const k = this.pulse * 0.04;
    this.body.scale.set(1 + k, 1 - k * 1.5, 1 + k);
  }

  dispose(): void {
    for (const o of [this.mound, this.grains, this.pebbles, this.leaf, this.twig, this.hole]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    ((this.hole.material as THREE.MeshBasicMaterial).map as THREE.Texture | null)?.dispose();
  }
}
