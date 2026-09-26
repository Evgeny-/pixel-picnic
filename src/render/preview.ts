import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { NestView, type HouseSkin } from './NestView';
import { antModel } from './AntsView';
import type { HatId } from './hats';
import type { LookItem } from '../core/looks';
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

/**
 * A small picture of a shop item, rendered once with a shared
 * offscreen renderer and cached as a data URL.
 */
export function lookPreview(kind: LookItem['kind'], id: string, roof = '#e8674a'): string {
  const key = `${kind}:${id}:${roof}`;
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
    obj = antModel('#e0663f', id as HatId);
    obj.rotation.y = 0.55;
    dispose = () => disposeTree(obj);
  }
  scene.add(obj);
  // Frame the object from the front and a little above, like in the game.
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  // Ants: close up on the head, where the hat is.
  const zoom = kind === 'hat' ? 0.62 : kind === 'box' ? 0.9 : 1.02;
  if (kind === 'hat') center.set(center.x, center.y + 0.12, center.z + 0.15);
  const dist = (size / (2 * Math.tan((camera.fov * Math.PI) / 360))) * zoom;
  camera.position.set(center.x + dist * 0.35, center.y + dist * (kind === 'box' ? 0.7 : 0.45), center.z + dist * 0.82);
  camera.lookAt(center);
  r.setClearColor(0x000000, 0);
  r.render(scene, camera);
  const url = r.domElement.toDataURL('image/png');
  dispose();
  cache.set(key, url);
  return url;
}
