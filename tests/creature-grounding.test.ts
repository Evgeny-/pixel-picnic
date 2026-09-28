import { afterAll, describe, expect, it } from 'vitest';
import { CREATURES } from '../src/core/creatures';
import { createCreatureRig } from '../src/render/creatureModel';
import { CreatureGrounding, type GroundingRect } from '../src/render/CreatureGrounding';

const rect: GroundingRect = { x0: -3, x1: 3, z0: -3, z1: 3,
  ix0: -2.7, ix1: 2.7, iz0: -2.7, iz1: 2.7, rim: 0.3 };
const top = rect.rim + 0.015;
const rigs = CREATURES.map((creature) => ({ id: creature.id, rig: createCreatureRig(creature.id) }));
const beaver = rigs.find((item) => item.id === 'beaver')!.rig;
const grounding = new CreatureGrounding(beaver);

afterAll(() => {
  for (const { rig } of rigs) {
    [rig.body, rig.eyes, rig.pupils, rig.legs, rig.details, rig.tail?.geometry]
      .forEach((geometry) => geometry?.dispose());
  }
});

describe('whole-creature frame grounding', () => {
  it('keeps the beaver lifted after its centre and body have entered the picture', () => {
    const withoutTail = new CreatureGrounding({ ...beaver, tail: undefined });
    for (const [x, z, yaw] of [[0, 2, Math.PI], [0, -2, 0], [-2, 0, Math.PI / 2], [2, 0, -Math.PI / 2]]) {
      expect(withoutTail.heightAt(x, z, yaw, 0.75, rect)).toBeCloseTo(0.04);
      expect(grounding.heightAt(x, z, yaw, 0.75, rect)).toBeGreaterThanOrEqual(top - 1e-9);
    }
  });

  it('keeps the trailing paddle lifted after its centre and body leave the frame', () => {
    const withoutTail = new CreatureGrounding({ ...beaver, tail: undefined });
    for (const [x, z, yaw] of [[0, 3.6, 0], [0, -3.6, Math.PI], [-3.6, 0, -Math.PI / 2], [3.6, 0, Math.PI / 2]]) {
      expect(withoutTail.heightAt(x, z, yaw, 0.75, rect)).toBeCloseTo(0);
      expect(grounding.heightAt(x, z, yaw, 0.75, rect)).toBeGreaterThanOrEqual(top - 1e-9);
    }
  });

  it('supports swinging tails at every frame side and diagonal body heading', () => {
    const tail = beaver.tail!;
    const vertices = tail.geometry.getAttribute('position');
    let tip = 0;
    for (let i = 1; i < vertices.count; i++) if (vertices.getZ(i) < vertices.getZ(tip)) tip = i;
    const size = 0.7;
    for (const swing of [-0.28, -0.14, 0, 0.14, 0.28]) {
      const localX = tail.pivot.x + vertices.getX(tip) * Math.cos(swing) + vertices.getZ(tip) * Math.sin(swing);
      const localZ = tail.pivot.z - vertices.getX(tip) * Math.sin(swing) + vertices.getZ(tip) * Math.cos(swing);
      for (let yaw = 0; yaw < Math.PI * 2; yaw += Math.PI / 4) {
        for (const [contactX, contactZ] of [[2.85, 0], [-2.85, 0], [0, 2.85], [0, -2.85]]) {
          const x = contactX - (localX * Math.cos(yaw) + localZ * Math.sin(yaw)) * size;
          const z = contactZ - (-localX * Math.sin(yaw) + localZ * Math.cos(yaw)) * size;
          expect(grounding.heightAt(x, z, yaw, size, rect)).toBeGreaterThanOrEqual(top - 1e-9);
        }
      }
    }
  });

  it('ramps up only within a short approach and reaches full clearance before touching the bevel', () => {
    const size = 0.75;
    const contactX = rect.x1 + 0.07 - grounding.footprint.minX * size;
    expect(grounding.heightAt(contactX + 0.13, 0, 0, size, rect)).toBe(0);
    const halfway = grounding.heightAt(contactX + 0.06, 0, 0, size, rect);
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(top);
    expect(grounding.heightAt(contactX, 0, 0, size, rect)).toBeCloseTo(top);
    expect(Math.abs(grounding.heightAt(contactX + 0.0599, 0, 0, size, rect) - halfway)).toBeLessThan(0.001);
  });

  for (const { id, rig } of rigs) {
    it(`${id} rests on the board or ground away from the rim and clears it on contact`, () => {
      const ground = new CreatureGrounding(rig);
      for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
        expect(ground.heightAt(0, 0, yaw, 0.75, rect)).toBe(0.04);
        for (const [x, z] of [[5, 5], [5, 0], [0, -5]]) expect(ground.heightAt(x, z, yaw, 0.75, rect)).toBe(0);
      }
      const bounds = ground.footprint;
      const x = rect.x1 - (bounds.minX + bounds.maxX) / 2 * 0.75;
      const z = -(bounds.minZ + bounds.maxZ) / 2 * 0.75;
      expect(ground.heightAt(x, z, 0, 0.75, rect)).toBeCloseTo(top);
      if (rig.tail) {
        const positions = rig.tail.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          for (const angle of [-0.28, -0.1, 0, 0.1, 0.28]) {
            const tx = rig.tail.pivot.x + positions.getX(i) * Math.cos(angle) + positions.getZ(i) * Math.sin(angle);
            const tz = rig.tail.pivot.z - positions.getX(i) * Math.sin(angle) + positions.getZ(i) * Math.cos(angle);
            expect(tx).toBeGreaterThanOrEqual(bounds.minX - 1e-7);
            expect(tx).toBeLessThanOrEqual(bounds.maxX + 1e-7);
            expect(tz).toBeGreaterThanOrEqual(bounds.minZ - 1e-7);
            expect(tz).toBeLessThanOrEqual(bounds.maxZ + 1e-7);
          }
        }
      }
    });
  }
});
