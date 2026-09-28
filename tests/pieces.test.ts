import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pieceGeometry, pieceMaterial } from '../src/render/pieces';
import type { PieceShape } from '../src/core/types';

// Captured from the original non-deduplicated geometries. Hash the drawn triangle
// stream, including float32 signed zero, so indexing cannot move a point, change
// a normal, reorder a triangle, or smooth a faceted edge unnoticed.
const originals: { shape: PieceShape; small: boolean; triangles: number; vertices: number; hash: string }[] = [
  { shape: 'cube', small: false, triangles: 108, vertices: 324, hash: '62426e010c2e97fcf797598da91b0aaa65d5b17d0509cd9e1d94bf9ec78e3efe' },
  { shape: 'cube', small: true, triangles: 108, vertices: 324, hash: '62426e010c2e97fcf797598da91b0aaa65d5b17d0509cd9e1d94bf9ec78e3efe' },
  { shape: 'coin', small: false, triangles: 216, vertices: 133, hash: '4db5f6e5b436af7013e65221f799cba2cf14935faa0b4ee3ecfef5e31f45a6a4' },
  { shape: 'coin', small: true, triangles: 144, vertices: 91, hash: 'e36e9c73bb178551ccc6230e93bacfffd795ac78214a73548577cb0df01afb91' },
  { shape: 'candy', small: false, triangles: 288, vertices: 187, hash: '15a5333ba4eda0c2dee770c4ed3f1ddf631056bc98704b464586a05079a54050' },
  { shape: 'candy', small: true, triangles: 168, vertices: 117, hash: 'c1384660fe76eeecb210efb126d1f4f73a58697a61299735f1684ab9fe8cf185' },
  { shape: 'hex', small: false, triangles: 72, vertices: 216, hash: '7561de6a7b75504473acd52a84a8128221745a5e9eac432eacbdba2a29fe0870' },
  { shape: 'hex', small: true, triangles: 72, vertices: 216, hash: '7561de6a7b75504473acd52a84a8128221745a5e9eac432eacbdba2a29fe0870' },
  { shape: 'diamond', small: false, triangles: 48, vertices: 144, hash: 'c7accd904c0b4982be92e025cb751df8f5377bca272b9541e56967baac01dc00' },
  { shape: 'diamond', small: true, triangles: 48, vertices: 144, hash: 'c7accd904c0b4982be92e025cb751df8f5377bca272b9541e56967baac01dc00' },
];

function triangleSignature(geometry: THREE.BufferGeometry): string {
  const index = geometry.getIndex()!;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const stream = new Float32Array(index.count * 6);
  for (let i = 0; i < index.count; i++) {
    const at = index.getX(i);
    for (let k = 0; k < 3; k++) {
      stream[i * 6 + k] = positions.array[at * 3 + k];
      stream[i * 6 + k + 3] = normals.array[at * 3 + k];
    }
  }
  return createHash('sha256').update(new Uint8Array(stream.buffer)).digest('hex');
}

describe('indexed picture pieces', () => {
  it.each(originals)('preserves exact triangle positions and normals for $shape (small=$small)', (original) => {
    const geometry = pieceGeometry(original.shape, original.small);
    expect(geometry.getIndex()).not.toBeNull();
    expect(geometry.getIndex()!.count).toBe(original.triangles * 3);
    expect(triangleSignature(geometry)).toBe(original.hash);
    expect(geometry.getAttribute('position').count).toBeLessThan(original.vertices);
    expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position']);
    geometry.dispose();
  });

  it('reduces the campaign cube from 324 repeated vertices to 56 shared ones', () => {
    const geometry = pieceGeometry('cube');
    expect(geometry.getAttribute('position').count).toBe(56);
    geometry.dispose();
  });

  it('keeps the UV-free material contract for board and carried pieces', () => {
    for (const shape of ['cube', 'coin', 'candy', 'hex', 'diamond'] as const) {
      const material = pieceMaterial(shape);
      for (const texture of [material.map, material.alphaMap, material.aoMap, material.bumpMap,
        material.normalMap, material.roughnessMap, material.metalnessMap, material.emissiveMap,
        material.displacementMap, material.lightMap]) expect(texture).toBeNull();
      material.dispose();
    }
  });
});
