import { describe, expect, it } from 'vitest';
import { HAT_LOOKS } from '../src/core/looks';
import { hatGeometry, type HatId } from '../src/render/hats';

describe('instanced accessory budget', () => {
  for (const hat of HAT_LOOKS) {
    it(`${hat.id} fits the colony's rendering budget`, () => {
      const geometry = hatGeometry(hat.id as HatId);
      if (hat.id === 'none') {
        expect(geometry).toBeNull();
        return;
      }
      expect(geometry).not.toBeNull();
      const positions = geometry!.attributes.position;
      const triangles = (geometry!.index?.count ?? positions.count) / 3;
      expect(triangles).toBeGreaterThan(0);
      expect(triangles).toBeLessThanOrEqual(700);
      expect(geometry!.attributes.color.count).toBe(positions.count);
      expect(geometry!.attributes.normal.count).toBe(positions.count);
      expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      geometry!.dispose();
    });
  }
});
