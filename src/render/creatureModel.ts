import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hatGeometry, type HatId } from './hats';
import { CREATURES, type CreatureId } from '../core/creatures';

export const LEGS = 6;
export const HIP_Z = [0.15, 0.07, -0.01];
export const LEG_YAW = [0.55, 0, -0.55];

export interface LegPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  side: number;
  phase: number;
}

export interface CreatureRig {
  body: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  pupils: THREE.BufferGeometry;
  legs: THREE.BufferGeometry;
  /** Natural accents, faces and fur markings with their own vertex colours. */
  details?: THREE.BufferGeometry;
  /** One coloured tail mesh for the whole colony; geometry is relative to its wagging pivot. */
  tail?: { geometry: THREE.BufferGeometry; pivot: { x: number; y: number; z: number } };
  legPoses: LegPose[];
  /** Optional transform from the shared accessory anchor into this creature's frame. */
  hatMatrix?: THREE.Matrix4;
}

/** Merge newly created parts and release the intermediate geometries. */
function join(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => p.index ? p.toNonIndexed() : p);
  const merged = mergeGeometries(flat, false)!;
  for (let i = 0; i < parts.length; i++) {
    parts[i].dispose();
    if (flat[i] !== parts[i]) flat[i].dispose();
  }
  merged.computeVertexNormals();
  return merged;
}

function ellipsoid(rx: number, ry: number, rz: number, x: number, y: number, z: number, segments = 8, rings = 5): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, segments, rings);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

function painted(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const values = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < values.length; i += 3) values.set([c.r, c.g, c.b], i);
  geo.setAttribute('color', new THREE.BufferAttribute(values, 3));
  return geo;
}

function tube(points: number[][], radius: number): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 8, radius, 4, false);
}

/** One continuous skin from rump to face, with no ant-like waist between body and head. */
function mammalBody(id: CreatureId): THREE.BufferGeometry {
  const stout = id === 'beaver';
  const rabbit = id === 'rabbit';
  const slim = id === 'fox' || id === 'dog';
  // z, horizontal radius, vertical radius, centre height
  const rings = [
    [-0.52, 0, 0, 0.25],
    [-0.44, stout ? 0.185 : 0.153, 0.16, 0.265],
    [-0.3, stout ? 0.28 : rabbit ? 0.263 : slim ? 0.21 : 0.235, stout ? 0.247 : 0.215, 0.28],
    [-0.1, stout ? 0.285 : rabbit ? 0.245 : slim ? 0.209 : 0.231, stout ? 0.238 : 0.212, 0.285],
    [0.08, stout ? 0.253 : slim ? 0.196 : 0.216, stout ? 0.223 : 0.197, 0.312],
    [0.245, stout ? 0.248 : 0.224, 0.202, 0.33],
    [0.38, stout ? 0.208 : 0.192, 0.165, 0.33],
    [0.49, stout ? 0.095 : 0.08, 0.083, 0.325],
    [0.535, 0, 0, 0.325],
  ];
  const segments = 12;
  const positions: number[] = [], indices: number[] = [];
  for (const [z, rx, ry, cy] of rings) {
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      positions.push(Math.cos(angle) * rx, cy + Math.sin(angle) * ry, z);
    }
  }
  for (let row = 0; row < rings.length - 1; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * segments + i, c = row * segments + (i + 1) % segments;
      const b = a + segments, d = c + segments;
      if (row > 0) indices.push(a, c, b);
      if (row < rings.length - 2) indices.push(c, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 2), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Thick, rounded triangular ears; their bevel and tapered outline also read from the side. */
function foxEar(scale = 1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.075, 0);
  shape.quadraticCurveTo(-0.088, 0.019, -0.059, 0.075);
  shape.lineTo(-0.012, 0.176);
  shape.quadraticCurveTo(0, 0.204, 0.014, 0.176);
  shape.lineTo(0.071, 0.033);
  shape.quadraticCurveTo(0.088, 0.001, 0.061, -0.008);
  shape.quadraticCurveTo(0, -0.026, -0.075, 0);
  const ear = new THREE.ExtrudeGeometry(shape, {
    depth: 0.065, steps: 1, curveSegments: 3,
    bevelEnabled: true, bevelSegments: 1, bevelSize: 0.012, bevelThickness: 0.014,
  });
  ear.scale(scale, scale, scale);
  return ear;
}

function humanRig(eyes: THREE.BufferGeometry, pupils: THREE.BufferGeometry): CreatureRig {
  const headLift = 0.27;
  eyes.translate(0, headLift, 0);
  pupils.translate(0, headLift, 0);
  const body = [ellipsoid(0.136, 0.158, 0.111, 0, 0.34, 0.3)];
  const details: THREE.BufferGeometry[] = [];
  const skin = '#efbd96';
  const accent = (geometry: THREE.BufferGeometry, color: string) => details.push(painted(geometry, color));
  accent(ellipsoid(0.193, 0.201, 0.183, 0, 0.6, 0.33), skin);
  accent(ellipsoid(0.056, 0.072, 0.056, 0, 0.433, 0.315), skin);
  accent(ellipsoid(0.035, 0.034, 0.037, 0, 0.61, 0.51), '#e8aa86');
  const hair = new THREE.SphereGeometry(1, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  hair.scale(0.189, 0.116, 0.176);
  hair.translate(0, 0.706, 0.315);
  accent(hair, '#664837');
  for (const side of [-1, 1]) {
    body.push(ellipsoid(0.063, 0.072, 0.071, side * 0.135, 0.375, 0.302));
    accent(ellipsoid(0.041, 0.064, 0.045, side * 0.187, 0.611, 0.321), skin);
    accent(ellipsoid(0.047, 0.069, 0.092, side * 0.153, 0.687, 0.255), '#664837');
    accent(tube([[side * 0.17, 0.36, 0.315], [side * 0.184, 0.295, 0.391],
      [side * 0.125, 0.3, 0.49]], 0.036), skin);
    accent(ellipsoid(0.045, 0.039, 0.044, side * 0.125, 0.3, 0.491), skin);
    accent(ellipsoid(0.013, 0.013, 0.007, side * 0.061, 0.375, 0.406), '#fff0ce');
  }
  // A small curved smile, kept below the big cartoon eyes.
  accent(tube([[-0.044, 0.557, 0.501], [0, 0.542, 0.51], [0.044, 0.557, 0.501]], 0.006), '#9f5e52');
  const legs = join([
    ellipsoid(0.047, 0.105, 0.046, 0, -0.085, 0, 6, 4),
    ellipsoid(0.054, 0.035, 0.084, 0, -0.183, 0.024),
  ]);
  return {
    body: join(body), eyes, pupils, legs, details: join(details),
    legPoses: [-1, 1].map((side) => ({ x: side * 0.07, y: 0.225, z: 0.296,
      yaw: 0, side, phase: side < 0 ? 0 : Math.PI })),
    hatMatrix: new THREE.Matrix4().makeTranslation(0, headLift, 0),
  };
}

/** Ant parts in local space: forward = +Z, up = +Y, total length ~1. */
export function buildBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ell = (rx: number, ry: number, rz: number, x: number, y: number, z: number, seg = 12) => {
    const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
    g.scale(rx, ry, rz);
    g.translate(x, y, z);
    parts.push(g);
  };
  ell(0.25, 0.21, 0.31, 0, 0.27, -0.33); // abdomen
  ell(0.075, 0.075, 0.09, 0, 0.23, -0.05, 8); // petiole
  ell(0.13, 0.12, 0.17, 0, 0.25, 0.08, 12); // thorax
  ell(0.22, 0.2, 0.21, 0, 0.33, 0.33); // head
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.07, 0.47, 0.38),
      new THREE.Vector3(s * 0.13, 0.66, 0.43),
      new THREE.Vector3(s * 0.22, 0.72, 0.6),
    ]);
    parts.push(new THREE.TubeGeometry(curve, 6, 0.022, 4, false));
    ell(0.045, 0.045, 0.045, s * 0.22, 0.72, 0.6, 8);
  }
  return join(parts);
}

export function buildEyes(r: number, z: number, y: number, x: number): THREE.BufferGeometry {
  const a = new THREE.SphereGeometry(r, 8, 6);
  a.translate(-x, y, z);
  const b = new THREE.SphereGeometry(r, 8, 6);
  b.translate(x, y, z);
  const merged = mergeGeometries([a, b], false)!;
  a.dispose();
  b.dispose();
  return merged;
}

export function buildLeg(): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.17, 0.09, 0),
    new THREE.Vector3(0.3, 0.02, 0),
    new THREE.Vector3(0.36, -0.2, 0),
  ]);
  return new THREE.TubeGeometry(curve, 6, 0.024, 4, false);
}

/**
 * All creatures face +Z and use the same head and eye frame. The upright human lifts that frame
 * through hatMatrix, so accessories and glasses still share the same fitting and saved choice.
 * Each returned geometry belongs to the caller and can be disposed independently.
 */
export function createCreatureRig(id: CreatureId): CreatureRig {
  const eyes = buildEyes(0.085, 0.47, 0.4, 0.1);
  const pupils = buildEyes(0.048, 0.535, 0.41, 0.105);
  if (id === 'ant') {
    return {
      body: buildBodyGeometry(), eyes, pupils, legs: buildLeg(),
      legPoses: Array.from({ length: LEGS }, (_, k) => {
        const side = k < 3 ? -1 : 1;
        const pair = k % 3;
        return { x: side * 0.08, y: 0.22, z: HIP_Z[pair], side,
          yaw: (side < 0 ? Math.PI : 0) - side * LEG_YAW[pair],
          phase: ((pair + (side > 0 ? 1 : 0)) % 2) * Math.PI };
      }),
    };
  }
  if (id === 'human') return humanRig(eyes, pupils);

  const body: THREE.BufferGeometry[] = [mammalBody(id)];
  const details: THREE.BufferGeometry[] = [];
  const tailParts: THREE.BufferGeometry[] = [];
  let tailPivot = { x: 0, y: 0, z: 0 };
  const accent = (g: THREE.BufferGeometry, color: string) => details.push(painted(g, color));
  const tailAccent = (g: THREE.BufferGeometry, color: string) => tailParts.push(painted(g, color));
  const muzzle = id === 'mouse' || id === 'rabbit' ? '#f6e4e2' : '#ffe6bd';

  if (id === 'beaver') {
    // A wide, flattened paddle stays visible in the overhead game camera.
    tailPivot = { x: 0, y: 0.075, z: -0.42 };
    tailAccent(ellipsoid(0.227, 0.039, 0.305, 0, 0.057, -0.66), '#72503b');
    for (const z of [-0.53, -0.64, -0.75, -0.85]) {
      const width = z === -0.85 ? 0.22 : 0.34;
      const ridge = new THREE.BoxGeometry(width, 0.007, 0.014);
      ridge.translate(0, z === -0.85 ? 0.083 : 0.094, z);
      tailAccent(ridge, '#906b4d');
    }
    for (const side of [-1, 1]) {
      body.push(ellipsoid(0.069, 0.071, 0.062, side * 0.213, 0.473, 0.22));
      accent(ellipsoid(0.04, 0.039, 0.013, side * 0.217, 0.48, 0.272), '#76513e');
      accent(ellipsoid(0.121, 0.093, 0.105, side * 0.09, 0.288, 0.474), '#e6c697');
      const tooth = new THREE.BoxGeometry(0.058, 0.092, 0.041);
      tooth.translate(side * 0.032, 0.189, 0.554);
      accent(tooth, '#fff9e9');
    }
    accent(ellipsoid(0.075, 0.045, 0.043, 0, 0.329, 0.57), '#4f392f');
  } else if (id === 'dog') {
    // Long floppy ears, a cream muzzle, and a lifted tail distinguish the puppy at a glance.
    for (const side of [-1, 1]) {
      const ear = ellipsoid(0.093, 0.19, 0.095, 0, 0, 0);
      ear.rotateZ(side * 0.25);
      ear.translate(side * 0.235, 0.345, 0.205);
      accent(ear, '#805334');
    }
    accent(ellipsoid(0.147, 0.106, 0.115, 0, 0.245, 0.465), muzzle);
    accent(ellipsoid(0.074, 0.052, 0.039, 0, 0.3, 0.564), '#342431');
    accent(ellipsoid(0.033, 0.044, 0.02, 0.045, 0.162, 0.543), '#ed8a9b');
    tailPivot = { x: 0, y: 0.3, z: -0.38 };
    tailAccent(tube([[0, 0.3, -0.38], [0, 0.4, -0.55], [0.06, 0.55, -0.61]], 0.06),
      CREATURES.find((creature) => creature.id === id)!.color);
    tailAccent(ellipsoid(0.067, 0.072, 0.067, 0.06, 0.55, -0.61), muzzle);
  } else if (id === 'mouse') {
    // Large ears have thick pink centres, and the tail curls to one side in the ground plane.
    for (const side of [-1, 1]) {
      body.push(ellipsoid(0.163, 0.17, 0.07, side * 0.235, 0.51, 0.16));
      accent(ellipsoid(0.119, 0.123, 0.024, side * 0.235, 0.514, 0.22), '#ef9baa');
    }
    accent(ellipsoid(0.106, 0.075, 0.108, 0, 0.25, 0.491), muzzle);
    accent(ellipsoid(0.05, 0.04, 0.036, 0, 0.284, 0.585), '#ef8eaa');
    tailPivot = { x: 0, y: 0.17, z: -0.4 };
    tailAccent(tube([[0, 0.17, -0.4], [-0.1, 0.1, -0.6], [-0.27, 0.07, -0.64],
      [-0.38, 0.07, -0.52], [-0.35, 0.08, -0.4]], 0.025), '#eaa3ac');
  } else if (id === 'fox') {
    // The upturned bushy tail and sharply pointed ears remain readable from above.
    const tail = ellipsoid(0.15, 0.14, 0.315, 0, 0, 0);
    tail.rotateX(0.48);
    tail.translate(0, 0.25, -0.58);
    tailPivot = { x: 0, y: 0.25, z: -0.36 };
    tailAccent(tail, '#d96c2d');
    const tailTip = ellipsoid(0.112, 0.11, 0.15, 0, 0, 0);
    tailTip.rotateX(0.48);
    tailTip.translate(0, 0.345, -0.78);
    tailAccent(tailTip, '#fff0d5');
    for (const side of [-1, 1]) {
      const ear = foxEar();
      ear.rotateZ(-side * 0.2);
      ear.translate(side * 0.175, 0.433, 0.147);
      accent(ear, '#8c4a35');
      // A smaller, inset volume makes a soft pink ear interior with a dark furry rim.
      const inset = foxEar(0.66);
      inset.scale(1, 1, 0.2);
      inset.rotateZ(-side * 0.2);
      inset.translate(side * 0.175, 0.457, 0.223);
      accent(inset, '#efb3a2');
      accent(ellipsoid(0.093, 0.073, 0.109, side * 0.066, 0.254, 0.476), muzzle);
    }
    accent(ellipsoid(0.053, 0.041, 0.038, 0, 0.289, 0.586), '#342431');
  } else if (id === 'rabbit') {
    // Ears rise behind the head and splay away from its centre, leaving room for hats.
    for (const side of [-1, 1]) {
      const ear = ellipsoid(0.077, 0.255, 0.062, 0, 0, 0);
      ear.rotateZ(-side * 0.23);
      ear.translate(side * 0.205, 0.66, 0.105);
      body.push(ear);
      const inset = ellipsoid(0.045, 0.204, 0.017, 0, 0, 0);
      inset.rotateZ(-side * 0.23);
      inset.translate(side * 0.205, 0.672, 0.157);
      accent(inset, '#ec99ae');
      accent(ellipsoid(0.089, 0.07, 0.075, side * 0.063, 0.254, 0.492), muzzle);
    }
    accent(ellipsoid(0.047, 0.035, 0.032, 0, 0.29, 0.555), '#e784a0');
    tailPivot = { x: 0, y: 0.28, z: -0.4 };
    tailAccent(ellipsoid(0.129, 0.13, 0.133, 0, 0.3, -0.498), '#fff8ef');
    const teeth = new THREE.BoxGeometry(0.064, 0.065, 0.028);
    teeth.translate(0, 0.2, 0.552);
    accent(teeth, '#fffdf6');
  }

  // Stubby feet tuck under the continuous body; beavers and mice sit especially low.
  const squat = id === 'beaver' || id === 'mouse';
  const hip = squat ? 0.172 : 0.22;
  const leg = join([
    ellipsoid(squat ? 0.074 : 0.067, squat ? 0.083 : 0.117, 0.073, 0.015, squat ? -0.052 : -0.08, 0, 6, 4),
    ellipsoid(id === 'beaver' ? 0.099 : 0.083, 0.039, id === 'beaver' ? 0.108 : 0.092,
      0.033, squat ? -0.13 : -0.177, 0.025),
  ]);
  const legPoses: LegPose[] = [];
  const hipWidth = id === 'beaver' ? 0.25 : id === 'mouse' ? 0.22 : id === 'rabbit' ? 0.215 : 0.19;
  for (const side of [-1, 1]) {
    for (let pair = 0; pair < 2; pair++) {
      legPoses.push({ x: side * hipWidth, y: hip, z: pair ? -0.3 : 0.125, side,
        yaw: side < 0 ? Math.PI : 0, phase: ((pair + (side > 0 ? 1 : 0)) % 2) * Math.PI });
    }
  }
  const tail = tailParts.length ? {
    geometry: join(tailParts).translate(-tailPivot.x, -tailPivot.y, -tailPivot.z), pivot: tailPivot,
  } : undefined;
  return { body: join(body), eyes, pupils, legs: leg, details: join(details), legPoses, tail };
}

/** An ordinary-mesh version of the gameplay rig for selectors and shop previews. */
export function creatureModel(id: CreatureId, color: string, hat: HatId = 'none'): THREE.Group {
  const g = new THREE.Group();
  const rig = createCreatureRig(id);
  const body = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  body.getHSL(hsl);
  const ant = id === 'ant';
  const legColor = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9), Math.max(0.03, hsl.l * (ant ? 0.45 : 0.75)));
  const surface = { roughness: ant ? 0.32 : 0.96, metalness: 0, envMapIntensity: ant ? 1.1 : 0.12 };
  g.add(new THREE.Mesh(rig.body, new THREE.MeshStandardMaterial({ color: body, ...surface })));
  g.add(new THREE.Mesh(rig.eyes, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: ant ? 0.25 : 0.45, metalness: 0 })));
  g.add(new THREE.Mesh(rig.pupils, new THREE.MeshStandardMaterial({ color: '#15101f', roughness: ant ? 0.2 : 0.35, metalness: 0 })));
  if (rig.details) g.add(new THREE.Mesh(rig.details, new THREE.MeshStandardMaterial({ vertexColors: true, ...surface })));
  if (rig.tail) {
    const tail = new THREE.Mesh(rig.tail.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, ...surface }));
    tail.position.set(rig.tail.pivot.x, rig.tail.pivot.y, rig.tail.pivot.z);
    g.add(tail);
  }
  const legMat = new THREE.MeshStandardMaterial({ color: legColor, ...surface, roughness: ant ? 0.5 : 0.96 });
  for (const pose of rig.legPoses) {
    const leg = new THREE.Mesh(rig.legs, legMat);
    leg.position.set(pose.x, pose.y, pose.z);
    leg.rotation.y = pose.yaw;
    g.add(leg);
  }
  const hatGeo = hatGeometry(hat);
  if (hatGeo) {
    if (rig.hatMatrix) hatGeo.applyMatrix4(rig.hatMatrix);
    g.add(new THREE.Mesh(hatGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide })));
  }
  return g;
}

/** Kept for callers that need an ant specifically. */
export function antModel(color: string, hat: HatId = 'none'): THREE.Group {
  return creatureModel('ant', color, hat);
}
