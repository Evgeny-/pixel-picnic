import * as THREE from 'three';
import type { Layout } from './layout';
import { radialTexture } from './textures';

/** The ant hill: a soft dirt mound with a dark entrance. */
export class NestView {
  readonly group = new THREE.Group();
  private mound: THREE.Mesh;
  private hole: THREE.Mesh;
  private crumbs: THREE.InstancedMesh;
  private pulse = 0;

  constructor(color = '#a8764c') {
    const profile: THREE.Vector2[] = [];
    const R = 0.95;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const r = R * (1 - t * 0.62);
      const y = Math.sin(t * Math.PI * 0.5) * 0.34;
      profile.push(new THREE.Vector2(r, y));
    }
    profile.push(new THREE.Vector2(0.001, 0.34));
    const geo = new THREE.LatheGeometry(profile, 40);
    // Lumpy dirt
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const n = 1 + Math.sin(a * 5) * 0.04 + Math.sin(a * 11 + 1.3) * 0.025;
      pos.setX(i, x * n);
      pos.setZ(i, z * n * 0.8);
    }
    geo.computeVertexNormals();
    this.mound = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide }));
    this.mound.castShadow = true;
    this.mound.receiveShadow = true;
    this.group.add(this.mound);

    const holeTex = radialTexture('rgba(20,10,5,1)', 'rgba(40,22,10,0)', 128);
    this.hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.44, 32),
      new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false }),
    );
    this.hole.rotation.x = -Math.PI / 2;
    this.hole.scale.set(1, 0.72, 1);
    this.hole.position.y = 0.345;
    this.group.add(this.hole);

    // A few pebbles/crumbs around the mound
    const n = 26;
    this.crumbs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.06, 0),
      new THREE.MeshStandardMaterial({ color: '#8d603c', roughness: 1 }),
      n,
    );
    this.crumbs.castShadow = true;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const r = 0.95 + Math.random() * 0.35;
      const s = 0.6 + Math.random() * 0.9;
      m.compose(
        new THREE.Vector3(Math.cos(a) * r, 0.03, Math.sin(a) * r * 0.8),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, 0)),
        new THREE.Vector3(s, s * 0.7, s),
      );
      this.crumbs.setMatrixAt(i, m);
    }
    this.group.add(this.crumbs);
  }

  setLayout(l: Layout): void {
    this.group.position.set(l.nest.x, 0, l.nest.z);
    const s = l.mode === 'portrait' ? 0.9 : 1.05;
    this.group.scale.setScalar(s);
  }

  /** Squash a little when an ant goes in. */
  gulp(): void {
    this.pulse = Math.min(1, this.pulse + 0.25);
  }

  update(dt: number): void {
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt * 3);
    const k = this.pulse * 0.05;
    this.mound.scale.set(1 + k, 1 - k, 1 + k);
  }

  dispose(): void {
    this.mound.geometry.dispose();
    (this.mound.material as THREE.Material).dispose();
    this.hole.geometry.dispose();
    const hm = this.hole.material as THREE.MeshBasicMaterial;
    hm.map?.dispose();
    hm.dispose();
    this.crumbs.geometry.dispose();
    (this.crumbs.material as THREE.Material).dispose();
  }
}
