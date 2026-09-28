import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type HatId = 'none' | 'party' | 'cap' | 'bow' | 'flower' | 'sunglasses' | 'tophat' | 'santa' | 'crown';

/** A part of a hat: geometry painted one color (vertex colors, so a hat is one instanced mesh). */
function part(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Everything a hat sits on: the top of the ant's head, tilted back a little. */
function onHead(parts: THREE.BufferGeometry[], tilt = -0.35, height = 0.5, forward = 0.29, scale = 1): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.scale(scale, scale, scale);
  g.rotateX(tilt);
  g.translate(0, height, forward);
  g.computeVertexNormals();
  return g;
}

function ribbon(shape: THREE.Shape, depth = 0.035, curveSegments = 8, bevelSegments = 2): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, curveSegments,
    bevelEnabled: true, bevelSegments, bevelSize: 0.008, bevelThickness: 0.008,
  });
}

/** A tapering fabric cone with a drooping tip, swept along the centre of the hat. */
function santaCrown(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.025, 0), new THREE.Vector3(0, 0.19, 0),
    new THREE.Vector3(0.07, 0.34, 0), new THREE.Vector3(0.2, 0.36, 0),
    new THREE.Vector3(0.27, 0.25, 0),
  ]);
  const positions: number[] = [], indices: number[] = [];
  const rings = 12, sides = 12;
  for (let row = 0; row <= rings; row++) {
    const t = row / rings;
    const center = curve.getPoint(t), tangent = curve.getTangent(t);
    const radius = 0.185 * Math.pow(1 - t, 0.85) + 0.003;
    for (let side = 0; side <= sides; side++) {
      const a = side / sides * Math.PI * 2;
      positions.push(center.x + tangent.y * Math.cos(a) * radius,
        center.y - tangent.x * Math.cos(a) * radius, Math.sin(a) * radius * 0.88);
      if (row < rings && side < sides) {
        const i = row * (sides + 1) + side, next = i + sides + 1;
        indices.push(i, next, i + 1, i + 1, next, next + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
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
      const cone = new THREE.ConeGeometry(0.165, 0.42, 20);
      cone.translate(0, 0.21, 0);
      const parts = [part(cone, '#7845db')];
      for (const y of [0.11, 0.25]) {
        const h = 0.035;
        const stripe = new THREE.CylinderGeometry(0.165 * (1 - (y + h / 2) / 0.42) + 0.002,
          0.165 * (1 - (y - h / 2) / 0.42) + 0.002, h, 20);
        stripe.translate(0, y, 0);
        parts.push(part(stripe, '#fff0bd'));
      }
      const band = new THREE.TorusGeometry(0.158, 0.022, 6, 20);
      band.rotateX(Math.PI / 2);
      band.translate(0, 0.015, 0);
      const pom = new THREE.SphereGeometry(0.055, 10, 8);
      pom.translate(0, 0.425, 0);
      parts.push(part(band, '#51decf'), part(pom, '#51decf'));
      return onHead(parts, -0.1, 0.53, 0.29, 1.12);
    }
    case 'cap': {
      const dome = new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.scale(1, 0.78, 0.95);
      const bill = new THREE.Shape();
      bill.moveTo(-0.18, 0.025);
      bill.quadraticCurveTo(-0.235, 0.18, -0.18, 0.265);
      bill.quadraticCurveTo(0, 0.36, 0.18, 0.265);
      bill.quadraticCurveTo(0.235, 0.18, 0.18, 0.025);
      bill.closePath();
      const visor = ribbon(bill, 0.018, 4, 1);
      visor.rotateX(Math.PI / 2);
      visor.translate(0, 0.006, 0);
      const band = new THREE.TorusGeometry(0.197, 0.014, 4, 16);
      band.rotateX(Math.PI / 2);
      band.scale(1, 1, 0.95);
      const button = new THREE.SphereGeometry(0.026, 6, 4);
      button.scale(1, 0.6, 1);
      button.translate(0, 0.16, 0);
      const parts = [part(dome, '#398de8'), part(visor, '#145cba'), part(band, '#144b9b'), part(button, '#fff2c8')];
      // Panel seams make the soft crown legible even when the brim points away.
      for (const a of [-Math.PI / 4, Math.PI / 4, Math.PI]) {
        const points: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++) {
          const theta = k / 8 * Math.PI / 2;
          points.push(new THREE.Vector3(Math.sin(a) * Math.sin(theta) * 0.202,
            Math.cos(theta) * 0.159, Math.cos(a) * Math.sin(theta) * 0.193));
        }
        parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 6, 0.005, 3, false), '#a2d5ff'));
      }
      const badge = new THREE.SphereGeometry(0.035, 8, 4);
      badge.scale(1, 1, 0.22);
      badge.translate(0, 0.072, 0.174);
      parts.push(part(badge, '#fff2c8'));
      return onHead(parts, 0.08, 0.545, 0.26);
    }
    case 'bow': {
      const parts: THREE.BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        const loop = new THREE.Shape();
        loop.moveTo(0, 0);
        loop.bezierCurveTo(0.08, 0.09, 0.22, 0.15, 0.22, 0.06);
        loop.bezierCurveTo(0.245, -0.07, 0.17, -0.09, 0, 0);
        const lobe = ribbon(loop, 0.055);
        if (side < 0) lobe.rotateY(Math.PI);
        parts.push(part(lobe, side < 0 ? '#45d9cb' : '#63ead9'));
        const tail = new THREE.Shape();
        tail.moveTo(0.015, -0.005);
        tail.lineTo(0.13, -0.16);
        tail.lineTo(0.065, -0.137);
        tail.lineTo(0.026, -0.175);
        tail.lineTo(-0.025, -0.025);
        tail.closePath();
        const end = ribbon(tail, 0.018);
        if (side < 0) end.rotateY(Math.PI);
        end.translate(0, 0, -0.03);
        parts.push(part(end, '#168f98'));
      }
      const knot = new THREE.SphereGeometry(0.052, 12, 8);
      knot.scale(0.8, 1, 0.8);
      knot.translate(0, 0, 0.036);
      parts.push(part(knot, '#e1fff3'));
      // The bow must read as a silhouette on moving creatures, not just in the shop close-up.
      const merged = onHead(parts, -0.6, 0.69, 0.3, 1.38);
      merged.rotateZ(-0.12);
      return merged;
    }
    case 'flower': {
      const parts: THREE.BufferGeometry[] = [];
      const leaf = new THREE.SphereGeometry(1, 6, 4);
      leaf.scale(0.11, 0.045, 0.021);
      leaf.rotateZ(-0.45);
      leaf.translate(-0.12, -0.1, -0.03);
      parts.push(part(leaf, '#329766'));
      for (let k = 0; k < 8; k++) {
        const petal = new THREE.SphereGeometry(1, 8, 5);
        petal.scale(0.087, 0.044, 0.025);
        petal.translate(0.104, 0, 0);
        petal.rotateZ(k / 8 * Math.PI * 2);
        parts.push(part(petal, k % 2 ? '#fff4ce' : '#ffffff'));
      }
      const middle = new THREE.SphereGeometry(0.066, 8, 5);
      middle.scale(1, 1, 0.55);
      middle.translate(0, 0, 0.025);
      parts.push(part(middle, '#ffc933'));
      const merged = onHead(parts, -0.65, 0.71, 0.32, 1.4);
      merged.translate(0.115, 0, 0);
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
      for (const p of parts) p.dispose();
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
      const brim = new THREE.TorusGeometry(0.176, 0.042, 6, 16);
      brim.rotateX(Math.PI / 2);
      brim.scale(1, 1, 0.9);
      brim.translate(0, 0.025, 0);
      const pom = new THREE.SphereGeometry(0.068, 8, 5);
      pom.translate(0.27, 0.245, 0);
      return onHead([part(santaCrown(), '#cf2145'), part(brim, '#fff8e9'), part(pom, '#fff8e9')], -0.08, 0.55);
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
      return onHead(parts, -0.25, 0.52, 0.29, 1.35);
    }
    default:
      return null;
  }
}
