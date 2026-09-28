import * as THREE from 'three';
import { FONT } from './textures';

/** Small unlit badges face the camera so their numbers keep normal proportions. */
export class QueueBadge {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private key = '';

  constructor() {
    this.canvas.width = 128;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: false,
    }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }

  setTilt(tilt: number): void {
    this.mesh.rotation.x = -Math.PI / 2 + tilt;
  }

  draw(text: string): void {
    if (text === this.key) return;
    this.key = text;
    const ctx = this.canvas.getContext('2d')!;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#fff7dc';
    ctx.fillStyle = '#6540bd';
    ctx.beginPath();
    ctx.roundRect(5, 5, w - 10, h - 10, 59);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${text.length > 1 ? 64 : 78}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
