import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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

function createPieceShape(shape: PieceShape, small: boolean): THREE.BufferGeometry {
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

/**
 * Index identical position/normal pairs without smoothing bevels or faceted edges.
 * These pieces use only material/instance color (BoardView and carried pieces),
 * so UV seams do not need their own vertices. Keep even tiny seam components and
 * signed zero exact: mergeVertices' tolerance alone can collapse those values.
 */
function indexPiece(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.deleteAttribute('uv');
  const position = geometry.getAttribute('position').array as Float32Array;
  const normal = geometry.getAttribute('normal').array as Float32Array;
  const positionBits = new Uint32Array(position.buffer, position.byteOffset, position.length);
  const normalBits = new Uint32Array(normal.buffer, normal.byteOffset, normal.length);
  const exactIds = new Float32Array(position.length / 3);
  const ids = new Map<string, number>();
  for (let i = 0; i < exactIds.length; i++) {
    const p = i * 3;
    const key = `${positionBits[p]},${positionBits[p + 1]},${positionBits[p + 2]},${normalBits[p]},${normalBits[p + 1]},${normalBits[p + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    exactIds[i] = id;
  }
  geometry.setAttribute('_exactMergeId', new THREE.Float32BufferAttribute(exactIds, 1));
  const indexed = mergeVertices(geometry);
  indexed.deleteAttribute('_exactMergeId');
  geometry.dispose();
  return indexed;
}

/**
 * Geometry of one picture piece, centered on the origin, about 1 cell wide and PIECE_H tall.
 * `small` uses fewer segments (pieces carried by animals). Indexed vertices avoid
 * repeating identical vertex-shader work for every triangle of every instance.
 */
export function pieceGeometry(shape: PieceShape, small = false): THREE.BufferGeometry {
  return indexPiece(createPieceShape(shape, small));
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
