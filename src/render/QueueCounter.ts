import * as THREE from 'three';
import type { Layout } from './layout';
import { queueCounterLayout } from './chainRouting';

/** The +N pill is also the visible attachment for a partner below the queue. */
export class QueueCounter {
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private text = '';
  private night = false;

  constructor() {
    this.canvas.width = 192;
    this.canvas.height = 112;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
    }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  setLayout(layout: Layout, columnX: number): void {
    const p = queueCounterLayout(layout, columnX);
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.scale.set(p.width, p.height / Math.cos(layout.tilt), 1);
  }

  setNight(on: boolean): void {
    if (this.night === on) return;
    this.night = on;
    this.paint();
  }

  draw(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.paint();
  }

  private paint(): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 192, 112);
    ctx.beginPath();
    ctx.roundRect(2, 2, 188, 108, 44);
    ctx.fillStyle = this.night ? '#172d2b' : '#f5e9bd';
    ctx.fill();
    ctx.strokeStyle = this.night ? '#748577' : '#b5a77c';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = `900 ${this.text.length > 2 ? 66 : 78}px Nunito`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.night ? '#fff6df' : '#786541';
    ctx.fillText(this.text, 96, 61);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
