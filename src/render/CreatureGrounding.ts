import * as THREE from 'three';
import type { CreatureRig } from './creatureModel';

export interface GroundingRect {
  x0: number; x1: number; z0: number; z1: number;
  ix0: number; ix1: number; iz0: number; iz1: number;
  rim: number;
}

export interface CreatureFootprint {
  minX: number; maxX: number; minZ: number; maxZ: number;
}

const TAIL_SWING = 0.28;
const BEVEL = 0.07;
const APPROACH = 0.12;
const CLEARANCE = 0.015;
const BOARD_FLOOR = 0.04;

/** A cached footprint supports the whole creature when any part crosses the picture frame. */
export class CreatureGrounding {
  readonly footprint: Readonly<CreatureFootprint>;
  private readonly centerX: number;
  private readonly centerZ: number;
  private readonly halfX: number;
  private readonly halfZ: number;

  constructor(rig: CreatureRig) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const extend = (x: number, z: number) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    };
    for (const geometry of [rig.body, rig.eyes, rig.pupils, rig.details]) {
      if (!geometry) continue;
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) extend(positions.getX(i), positions.getZ(i));
    }

    // Only eight leg bounds corners need transforming. Sample the complete gait once;
    // the small padding covers the extrema between these closely spaced phases.
    const legBounds = new THREE.Box3().setFromBufferAttribute(rig.legs.getAttribute('position') as THREE.BufferAttribute);
    const matrix = new THREE.Matrix4(), rotation = new THREE.Euler(), point = new THREE.Vector3();
    const ant = rig.legPoses.length === 6;
    for (const pose of rig.legPoses) {
      for (let phase = 0; phase < 32; phase++) {
        const angle = phase / 32 * Math.PI * 2;
        const swing = Math.sin(angle) * 0.38;
        const lift = Math.max(0, Math.cos(angle)) * 0.22;
        rotation.set(ant ? 0 : swing, ant ? pose.yaw - pose.side * swing : pose.yaw, ant ? lift : 0);
        matrix.makeRotationFromEuler(rotation);
        for (let corner = 0; corner < 8; corner++) {
          point.set(corner & 1 ? legBounds.max.x : legBounds.min.x,
            corner & 2 ? legBounds.max.y : legBounds.min.y,
            corner & 4 ? legBounds.max.z : legBounds.min.z).applyMatrix4(matrix);
          extend(pose.x + point.x - 0.006, pose.z + point.z - 0.006);
          extend(pose.x + point.x + 0.006, pose.z + point.z + 0.006);
        }
      }
    }

    if (rig.tail) {
      const positions = rig.tail.geometry.getAttribute('position');
      const pivot = rig.tail.pivot;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getZ(i);
        const sample = (angle: number) => {
          const c = Math.cos(angle), s = Math.sin(angle);
          extend(pivot.x + x * c + z * s, pivot.z - x * s + z * c);
        };
        sample(-TAIL_SWING); sample(TAIL_SWING);
        // Coordinate extrema of the rotating vertex may lie between the two end poses.
        for (const critical of [Math.atan2(z, x), Math.atan2(-x, z)]) {
          for (let turn = -1; turn <= 1; turn++) {
            const angle = critical + turn * Math.PI;
            if (angle >= -TAIL_SWING && angle <= TAIL_SWING) sample(angle);
          }
        }
      }
    }
    this.footprint = Object.freeze({ minX, maxX, minZ, maxZ });
    this.centerX = (minX + maxX) / 2;
    this.centerZ = (minZ + maxZ) / 2;
    this.halfX = (maxX - minX) / 2;
    this.halfZ = (maxZ - minZ) / 2;
  }

  /** No geometry work or allocations in the animation loop. */
  heightAt(x: number, z: number, yaw: number, size: number, rect: GroundingRect): number {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const scale = Math.abs(size);
    const cx = x + (this.centerX * c + this.centerZ * s) * scale;
    const cz = z + (-this.centerX * s + this.centerZ * c) * scale;
    const hx = this.halfX * scale, hz = this.halfZ * scale;
    const base = this.gap(cx, cz, hx, hz, c, s, rect.ix0, rect.ix1, rect.iz0, rect.iz1) <= 0 ? BOARD_FLOOR : 0;
    const distance = Math.min(
      this.gap(cx, cz, hx, hz, c, s, rect.x0 - BEVEL, rect.ix0 + BEVEL, rect.z0 - BEVEL, rect.z1 + BEVEL),
      this.gap(cx, cz, hx, hz, c, s, rect.ix1 - BEVEL, rect.x1 + BEVEL, rect.z0 - BEVEL, rect.z1 + BEVEL),
      this.gap(cx, cz, hx, hz, c, s, rect.x0 - BEVEL, rect.x1 + BEVEL, rect.z0 - BEVEL, rect.iz0 + BEVEL),
      this.gap(cx, cz, hx, hz, c, s, rect.x0 - BEVEL, rect.x1 + BEVEL, rect.iz1 - BEVEL, rect.z1 + BEVEL),
    );
    const t = Math.max(0, Math.min(1, 1 - distance / APPROACH));
    const ramp = t * t * (3 - 2 * t);
    return base + (Math.max(base, rect.rim + CLEARANCE) - base) * ramp;
  }

  /** Separating-axis gap between the oriented footprint and an axis-aligned frame strip. */
  private gap(cx: number, cz: number, hx: number, hz: number, c: number, s: number,
    x0: number, x1: number, z0: number, z1: number): number {
    const dx = cx - (x0 + x1) / 2, dz = cz - (z0 + z1) / 2;
    const rx = (x1 - x0) / 2, rz = (z1 - z0) / 2;
    const ac = Math.abs(c), as = Math.abs(s);
    return Math.max(
      Math.abs(dx) - (hx * ac + hz * as + rx),
      Math.abs(dz) - (hx * as + hz * ac + rz),
      Math.abs(dx * c - dz * s) - (hx + rx * ac + rz * as),
      Math.abs(dx * s + dz * c) - (hz + rx * as + rz * ac),
    );
  }
}
