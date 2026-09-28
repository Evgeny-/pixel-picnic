import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CREATURES } from '../src/core/creatures';
import { creatureModel } from '../src/render/creatureModel';
import { centeredTurntableModel, frameTurntable } from '../src/render/CreatureTurntable';
import type { HatId } from '../src/render/hats';

function vertices(model: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const positions = child.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld));
    }
  });
  return points;
}

function release(model: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

describe('creature turntable framing', () => {
  it('uses the footprint centre to avoid wasting preview space around an off-centre tail', () => {
    const raw = creatureModel('beaver', '#ad774b', 'none');
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
    frameTurntable(camera, raw, 1);
    const originalWidth = camera.right - camera.left;
    const originalFloor = new THREE.Box3().setFromObject(raw).min.y;
    const model = centeredTurntableModel(raw);
    const bounds = new THREE.Box3().setFromObject(model);
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
    expect(bounds.min.y).toBe(originalFloor);
    frameTurntable(camera, model, 1);
    expect(camera.right - camera.left).toBeLessThan(originalWidth * 0.9);
    release(model);
  });

  for (const creature of CREATURES) {
    it(`keeps every ${creature.id} ear, tail and accessory inside the frame throughout a turn`, () => {
      for (const hat of ['none', 'party', 'crown', 'flower'] as HatId[]) {
        const model = centeredTurntableModel(creatureModel(creature.id, creature.color, hat));
        const points = vertices(model);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
        for (const aspect of [0.75, 1, 1.5]) {
          frameTurntable(camera, model, aspect);
          for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 8) {
            const turn = new THREE.Matrix4().makeRotationY(yaw);
            let largest = 0;
            let depth = 0;
            const projected = new THREE.Vector3();
            for (const point of points) {
              projected.copy(point).applyMatrix4(turn).project(camera);
              largest = Math.max(largest, Math.abs(projected.x), Math.abs(projected.y));
              depth = Math.max(depth, Math.abs(projected.z));
            }
            expect(largest, `${creature.id}/${hat}, aspect=${aspect}, yaw=${yaw}`).toBeLessThan(0.92);
            expect(depth).toBeLessThan(1);
          }
        }
        release(model);
      }
    });
  }

  it('preserves the vertical rotation axis and does not change framing with yaw', () => {
    const model = centeredTurntableModel(creatureModel('beaver', '#ad774b', 'party'));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
    frameTurntable(camera, model, 1);
    const position = camera.position.clone();
    const top = camera.top;
    model.rotation.y = 2;
    frameTurntable(camera, model, 1);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-9);
    expect(camera.top).toBeCloseTo(top, 9);
    expect(model.position.toArray()).toEqual([0, 0, 0]);
    expect(model.rotation.y).toBe(2);
    release(model);
  });
});
