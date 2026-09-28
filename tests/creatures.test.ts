import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CREATURES, isCreatureId } from '../src/core/creatures';
import { createCreatureRig, creatureModel } from '../src/render/creatureModel';
import { HAT_LOOKS } from '../src/core/looks';
import type { HatId } from '../src/render/hats';

describe('creature rigs', () => {
  it('accepts only saved choices that have a model', () => {
    expect(CREATURES.map((item) => item.id)).toEqual(['ant', 'beaver', 'dog', 'mouse', 'fox', 'rabbit', 'human']);
    for (const creature of CREATURES) expect(isCreatureId(creature.id)).toBe(true);
    for (const invalid of ['spider', '', null, undefined, 1]) expect(isCreatureId(invalid)).toBe(false);
  });

  it('keeps the four starter companions free and prices extras in coins', () => {
    expect(CREATURES.filter((item) => item.price === 0).map((item) => item.id)).toEqual(['ant', 'beaver', 'dog', 'mouse']);
    expect(CREATURES.find((item) => item.id === 'fox')!.price).toBe(900);
    expect(CREATURES.find((item) => item.id === 'rabbit')!.price).toBe(1200);
    expect(CREATURES.find((item) => item.id === 'human')!.price).toBe(3000);
  });

  it('gives the beaver one broad continuous torso instead of a narrow insect waist', () => {
    const rig = createCreatureRig('beaver');
    const material = new THREE.MeshBasicMaterial();
    const body = new THREE.Mesh(rig.body, material);
    for (const z of [-0.25, 0, 0.2]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(1, 0.32, z), new THREE.Vector3(-1, 0, 0));
      const hits = ray.intersectObject(body);
      expect(hits).toHaveLength(1);
      expect(hits[0].point.x).toBeGreaterThan(0.22);
    }
    [rig.body, rig.eyes, rig.pupils, rig.legs, rig.details!, rig.tail!.geometry].forEach((geometry) => geometry.dispose());
    material.dispose();
  });

  for (const creature of CREATURES) {
    it(`${creature.id} supplies complete, finite geometry for every instanced part`, () => {
      const rig = createCreatureRig(creature.id);
      expect(rig.legPoses).toHaveLength(creature.id === 'ant' ? 6 : creature.id === 'human' ? 2 : 4);
      expect(new Set(rig.legPoses.map((pose) => pose.phase)).size).toBe(2);
      const parts = [rig.body, rig.eyes, rig.pupils, rig.legs, ...(rig.details ? [rig.details] : []),
        ...(rig.tail ? [rig.tail.geometry] : [])];
      // Keep the complete animated creature affordable when many are visible at once.
      const vertexCount = parts.reduce((sum, part) => sum + part.attributes.position.count, 0)
        + rig.legs.attributes.position.count * (rig.legPoses.length - 1);
      expect(vertexCount).toBeLessThan(6_500);
      const triangles = (part: THREE.BufferGeometry) => (part.index?.count ?? part.attributes.position.count) / 3;
      const triangleCount = parts.reduce((sum, part) => sum + triangles(part), 0)
        + triangles(rig.legs) * (rig.legPoses.length - 1);
      expect(triangleCount).toBeLessThanOrEqual(2_000);
      for (const part of parts) {
        expect(part.attributes.position.count).toBeGreaterThan(0);
        expect(part.attributes.normal.count).toBe(part.attributes.position.count);
        expect(Array.from(part.attributes.position.array).every(Number.isFinite)).toBe(true);
        part.computeBoundingBox();
        const size = part.boundingBox!.getSize(new THREE.Vector3());
        expect(Math.max(size.x, size.y, size.z)).toBeLessThan(1.6);
      }
      if (creature.id !== 'ant') {
        expect(rig.details).toBeDefined();
        expect(rig.details!.attributes.color.count).toBe(rig.details!.attributes.position.count);
      }
      if (creature.id !== 'ant' && creature.id !== 'human') {
        expect(rig.tail).toBeDefined();
        expect(rig.tail!.geometry.attributes.color.count).toBe(rig.tail!.geometry.attributes.position.count);
        expect(Object.values(rig.tail!.pivot).every(Number.isFinite)).toBe(true);
        expect(rig.tail!.pivot.z).toBeLessThan(-0.3);
      } else expect(rig.tail).toBeUndefined();
      parts.forEach((part) => part.dispose());
    });

    it(`${creature.id} supports every existing accessory without oversized bounds`, () => {
      for (const hat of HAT_LOOKS) {
        const model = creatureModel(creature.id, creature.color, hat.id as HatId);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        expect(size.x).toBeGreaterThan(0.3);
        expect(size.y).toBeGreaterThan(0.4);
        expect(Math.max(size.x, size.y, size.z)).toBeLessThan(1.8);
        expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          geometries.add(object.geometry);
          const mats = Array.isArray(object.material) ? object.material : [object.material];
          mats.forEach((material) => materials.add(material));
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
      }
    });
  }
});
