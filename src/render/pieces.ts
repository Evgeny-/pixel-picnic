import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { PieceShape } from '../core/types';

/** Height of a piece relative to the cell size (the footprint is about one cell). */
export const PIECE_H = 0.62;

/** Beveled prism/puck: a lathe profile around Y, `sides` segments, centered on the origin. */
function lathePiece(radius: number, sides: number, bevel: number, phi = 0): THREE.BufferGeometry {
  const h = PIECE_H / 2;
  const pts = [
    [0, -h],
    [radius - bevel * 0.6, -h],
    [radius, -h + bevel * 0.6],
    [radius, h - bevel],
    [radius - bevel * 0.35, h - bevel * 0.2],
    [radius - bevel, h],
    [0, h],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, sides, phi);
}

/** Flat normals for faceted shapes (hexagons, diamonds). */
function faceted(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Geometry of one picture piece, centered on the origin, about 1 cell wide and PIECE_H tall.
 * `small` uses fewer segments (pieces carried by ants).
 */
export function pieceGeometry(shape: PieceShape, small = false): THREE.BufferGeometry {
  switch (shape) {
    case 'coin':
      return lathePiece(0.46, small ? 12 : 18, 0.08);
    case 'candy': {
      const g = new THREE.SphereGeometry(0.5, small ? 12 : 16, small ? 8 : 10);
      g.scale(0.95, PIECE_H, 0.95);
      return g;
    }
    case 'hex':
      // Flat side towards the camera; flat-to-flat width ≈ 0.9.
      return faceted(lathePiece(0.52, 6, 0.1, Math.PI / 6));
    case 'diamond':
      // A rhombus tile: corners point at the neighbouring cells.
      return faceted(lathePiece(0.56, 4, 0.12));
    default:
      return new RoundedBoxGeometry(0.94, PIECE_H, 0.94, 1, 0.14);
  }
}

/** Surface of the pieces: candies and gems are glossier than wooden cubes. */
export function pieceMaterial(shape: PieceShape): THREE.MeshStandardMaterial {
  const rough: Record<PieceShape, number> = { cube: 0.42, coin: 0.34, candy: 0.2, hex: 0.36, diamond: 0.16 };
  return new THREE.MeshStandardMaterial({
    roughness: rough[shape],
    metalness: shape === 'diamond' ? 0.08 : 0,
    envMapIntensity: shape === 'diamond' || shape === 'candy' ? 1.35 : 0.9,
  });
}
