import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type HatId = 'none' | 'party' | 'cap' | 'bow' | 'flower' | 'sunglasses' | 'tophat' | 'santa' | 'crown';

/** A part of a hat: geometry painted one color (vertex colors, so a hat is one instanced mesh). */
function part(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Everything a hat sits on: the top of the ant's head, tilted back a little. */
function onHead(parts: THREE.BufferGeometry[], tilt = -0.35): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.rotateX(tilt);
  g.translate(0, 0.5, 0.29);
  g.computeVertexNormals();
  return g;
}

/**
 * Geometry of an ant accessory in the ant's own frame (the frame the body geometry uses: head
 * around (0, 0.33, 0.33), facing +z), or null for no hat.
 */
export function hatGeometry(id: HatId): THREE.BufferGeometry | null {
  switch (id) {
    case 'party': {
      const cone = new THREE.ConeGeometry(0.1, 0.26, 16);
      cone.translate(0, 0.13, 0);
      const band = new THREE.TorusGeometry(0.095, 0.018, 6, 20);
      band.rotateX(Math.PI / 2);
      band.translate(0, 0.02, 0);
      const pom = new THREE.SphereGeometry(0.04, 10, 8);
      pom.translate(0, 0.27, 0);
      return onHead([part(cone, '#ff5d8f'), part(band, '#ffd166'), part(pom, '#ffd166')]);
    }
    case 'cap': {
      const dome = new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.scale(1, 0.62, 1);
      const visor = new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16, 1, false, -Math.PI / 2, Math.PI);
      visor.scale(1, 1, 1.1);
      visor.translate(0, 0.01, 0.06);
      const button = new THREE.SphereGeometry(0.022, 8, 6);
      button.translate(0, 0.1, 0);
      return onHead([part(dome, '#3a86ff'), part(visor, '#1f5fd1'), part(button, '#ffffff')], -0.2);
    }
    case 'bow': {
      const left = new THREE.ConeGeometry(0.07, 0.12, 12);
      left.rotateZ(-Math.PI / 2);
      left.translate(-0.07, 0, 0);
      const right = new THREE.ConeGeometry(0.07, 0.12, 12);
      right.rotateZ(Math.PI / 2);
      right.translate(0.07, 0, 0);
      const knot = new THREE.SphereGeometry(0.035, 10, 8);
      const g = [part(left, '#ff4fa3'), part(right, '#ff4fa3'), part(knot, '#ff82c3')];
      const merged = onHead(g, -0.5);
      merged.translate(0.07, 0.02, -0.02);
      return merged;
    }
    case 'flower': {
      const parts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 5; k++) {
        const petal = new THREE.SphereGeometry(0.05, 10, 6);
        petal.scale(1, 0.35, 0.6);
        petal.translate(0.055, 0, 0);
        petal.rotateY((k / 5) * Math.PI * 2);
        parts.push(part(petal, '#ffffff'));
      }
      const middle = new THREE.SphereGeometry(0.035, 10, 8);
      middle.scale(1, 0.6, 1);
      middle.translate(0, 0.015, 0);
      parts.push(part(middle, '#ffc933'));
      const merged = onHead(parts, -0.6);
      merged.translate(0.09, 0.01, 0);
      return merged;
    }
    case 'sunglasses': {
      // At eye level rather than on top of the head.
      const parts: THREE.BufferGeometry[] = [];
      for (const s of [-1, 1]) {
        const lens = new THREE.CylinderGeometry(0.075, 0.075, 0.02, 16);
        lens.rotateX(Math.PI / 2);
        lens.translate(s * 0.095, 0.41, 0.535);
        parts.push(part(lens, '#1d1d24'));
      }
      const bridge = new THREE.BoxGeometry(0.06, 0.018, 0.018);
      bridge.translate(0, 0.43, 0.54);
      parts.push(part(bridge, '#1d1d24'));
      const g = mergeGeometries(parts, false)!;
      g.computeVertexNormals();
      return g;
    }
    case 'tophat': {
      const crown = new THREE.CylinderGeometry(0.095, 0.105, 0.22, 16);
      crown.translate(0, 0.13, 0);
      const brim = new THREE.CylinderGeometry(0.17, 0.17, 0.022, 20);
      brim.translate(0, 0.02, 0);
      const band = new THREE.CylinderGeometry(0.107, 0.107, 0.045, 16);
      band.translate(0, 0.06, 0);
      return onHead([part(crown, '#2b2d42'), part(brim, '#2b2d42'), part(band, '#e63946')]);
    }
    case 'santa': {
      const cone = new THREE.ConeGeometry(0.11, 0.3, 16);
      cone.translate(0, 0.15, 0);
      cone.rotateZ(-0.35);
      const brim = new THREE.TorusGeometry(0.1, 0.035, 8, 20);
      brim.rotateX(Math.PI / 2);
      brim.translate(0, 0.02, 0);
      const pom = new THREE.SphereGeometry(0.045, 10, 8);
      pom.translate(0.11, 0.3, 0);
      return onHead([part(cone, '#d62828'), part(brim, '#ffffff'), part(pom, '#ffffff')]);
    }
    case 'crown': {
      const parts: THREE.BufferGeometry[] = [];
      const ring = new THREE.CylinderGeometry(0.12, 0.11, 0.08, 16, 1, true);
      ring.translate(0, 0.04, 0);
      parts.push(part(ring, '#ffc933'));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const spike = new THREE.ConeGeometry(0.03, 0.08, 6);
        spike.translate(Math.cos(a) * 0.115, 0.12, Math.sin(a) * 0.115);
        parts.push(part(spike, '#ffc933'));
        const gem = new THREE.SphereGeometry(0.02, 8, 6);
        gem.translate(Math.cos(a) * 0.12, 0.045, Math.sin(a) * 0.12);
        parts.push(part(gem, k % 2 ? '#3a86ff' : '#e63946'));
      }
      return onHead(parts, -0.25);
    }
    default:
      return null;
  }
}
