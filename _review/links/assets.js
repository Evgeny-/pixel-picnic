import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BoxStyle } from '../../src/render/boxStyle.ts';
import { mysteryTexture } from '../../src/render/textures.ts';
import { paintGround } from '../../src/render/groundPainter.ts';
import { THEMES } from '../../src/render/themes.ts';
import { boxColors, MYSTERY } from './scenes.js';

export function makeAssets() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(224, 224, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, .04).texture;
  const scene = new THREE.Scene();
  scene.environment = env;
  const hemi = new THREE.HemisphereLight('#fffaf0', '#7a8f6a', .9);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.9);
  sun.position.set(-3, 8, 4);
  scene.add(hemi, sun);
  const camera = new THREE.OrthographicCamera(-.63, .63, .63, -.63, .1, 50);
  camera.position.set(0, 10, 4.4);
  camera.lookAt(0, .31, 0);
  const style = new BoxStyle('classic');
  const stripes = mysteryTexture();
  const images = {};
  for (const night of [false, true]) {
    hemi.color.set(night ? '#9aa8e6' : '#fffaf0');
    hemi.intensity = night ? .62 : .9;
    sun.color.set(night ? '#dbe3ff' : '#fff4e0');
    sun.intensity = night ? 1.75 : 2.9;
    scene.environmentIntensity = night ? .3 : .42;
    renderer.toneMappingExposure = night ? .95 : 1.05;
    for (const color of boxColors) {
      const box = style.createBody(color);
      if (color === MYSTERY) box.material.map = stripes;
      scene.add(box);
      renderer.render(scene, camera);
      images[`${night ? 'night' : 'day'}-${color}`] = renderer.domElement.toDataURL('image/png');
      scene.remove(box);
      box.material.dispose();
    }
  }
  style.dispose(); stripes.dispose(); env.dispose(); room.dispose(); pmrem.dispose(); renderer.dispose();
  renderer.forceContextLoss();
  return { images, ground: paintGround(THEMES[0], 512).toDataURL('image/png') };
}
