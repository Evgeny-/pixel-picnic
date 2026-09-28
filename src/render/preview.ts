import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { NestView, type HouseSkin } from './NestView';
import { creatureModel } from './creatureModel';
import type { HatId } from './hats';
import type { LookItem } from '../core/looks';
import { CREATURES, type CreatureId } from '../core/creatures';
import { BOX_H, BOX_LABEL_Z, BoxStyle } from './boxStyle';
import { LabelTexture } from './textures';

const SIZE = 180;
let renderer: THREE.WebGLRenderer | null = null;
let environment: THREE.Texture | null = null;
const cache = new Map<string, string>();

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
  }
  return renderer;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) mat.dispose();
  });
}

/** Fit the visible silhouette, rather than the much larger diagonal of its 3D bounds. */
function frameCreature(camera: THREE.PerspectiveCamera, object: THREE.Object3D, padding: number): void {
  const back = new THREE.Vector3(0.35, 0.45, 0.82).normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  const point = new THREE.Vector3();
  const projected: number[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const positions = child.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld);
      const x = point.dot(right), y = point.dot(up), z = point.dot(back);
      projected.push(x, y, z);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  });
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanX = tanY * camera.aspect;
  let distance = camera.near + maxZ - cz;
  for (let i = 0; i < projected.length; i += 3) {
    const reach = Math.max(Math.abs(projected[i] - cx) / tanX, Math.abs(projected[i + 1] - cy) / tanY);
    distance = Math.max(distance, projected[i + 2] - cz + reach * padding);
  }
  const center = new THREE.Vector3().addScaledVector(right, cx).addScaledVector(up, cy).addScaledVector(back, cz);
  camera.position.copy(center).addScaledVector(back, distance);
  camera.lookAt(center);
}

/**
 * A small picture of a shop item, rendered once with a shared
 * offscreen renderer and cached as a data URL.
 */
export function lookPreview(kind: LookItem['kind'], id: string, roof = '#e8674a', creature: CreatureId = 'ant'): string {
  return renderPreview(kind, id, roof, creature);
}

/** A character portrait, using exactly the rig and accessory worn in the game. */
export function creaturePreview(id: CreatureId, hat: HatId = 'none'): string {
  return renderPreview('creature', hat, '#e8674a', id);
}

function renderPreview(kind: LookItem['kind'] | 'creature', id: string, roof: string, creature: CreatureId): string {
  const key = `${kind}:${id}:${roof}:${creature}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = getRenderer();
  const scene = new THREE.Scene();
  if (kind === 'box') {
    scene.environment = environment;
    scene.environmentIntensity = 0.7;
  }
  scene.add(new THREE.HemisphereLight('#fffaf0', '#8a7a6a', 1.4));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(-2, 4, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  let obj: THREE.Object3D;
  let dispose: () => void;
  if (kind === 'house') {
    const nest = new NestView(roof, id as HouseSkin);
    obj = nest.group;
    dispose = () => nest.dispose();
  } else if (kind === 'box') {
    const style = new BoxStyle(id);
    const body = style.createBody('#aa75eb');
    const label = new LabelTexture(128);
    label.draw('24', { fill: '#ffffff', stroke: '#503175', shadow: 'rgba(0,0,0,0.2)' });
    const labelGeo = new THREE.PlaneGeometry(0.86, 0.86);
    const labelMat = new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, depthWrite: false });
    const labelMesh = new THREE.Mesh(labelGeo, labelMat);
    labelMesh.rotation.x = -Math.PI / 2;
    labelMesh.position.set(0, BOX_H + 0.012, BOX_LABEL_Z);
    obj = new THREE.Group();
    obj.add(body, labelMesh);
    dispose = () => {
      body.material.dispose();
      style.dispose();
      labelGeo.dispose();
      labelMat.dispose();
      label.dispose();
    };
  } else {
    const color = CREATURES.find((item) => item.id === creature)!.color;
    obj = creatureModel(creature, color, id as HatId);
    obj.rotation.y = 0.55;
    dispose = () => disposeTree(obj);
  }
  scene.add(obj);
  // Frame the object from the front and a little above, like in the game.
  if (kind === 'creature' || kind === 'hat') {
    // Roughly 85% of the card, with every ear, tail and accessory inside the image.
    frameCreature(camera, obj, kind === 'hat' ? 1.12 : 1.18);
  } else {
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = (size / (2 * Math.tan((camera.fov * Math.PI) / 360))) * (kind === 'box' ? 0.9 : 1.02);
    camera.position.set(center.x + dist * 0.35, center.y + dist * (kind === 'box' ? 0.7 : 0.45), center.z + dist * 0.82);
    camera.lookAt(center);
  }
  r.setClearColor(0x000000, 0);
  r.render(scene, camera);
  const url = r.domElement.toDataURL('image/png');
  dispose();
  cache.set(key, url);
  return url;
}
