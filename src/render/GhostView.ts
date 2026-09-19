/**
 * The translucent preview of what a click would build, and the highlight shown
 * over what a click would remove.
 */

import { BoxGeometry, Color, Mesh, MeshBasicMaterial, Scene } from 'three';
import { footprintCenter } from '../core/grid';

const VALID_COLOR = 0x8fe08a;
const INVALID_COLOR = 0xe4635c;
const ERASE_COLOR = 0xe4635c;

export class GhostView {
  private readonly mesh: Mesh<BoxGeometry, MeshBasicMaterial>;
  private readonly colour = new Color();

  constructor(scene: Scene) {
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    this.mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }

  hide(): void {
    this.mesh.visible = false;
  }

  showBuilding(
    x: number,
    y: number,
    w: number,
    h: number,
    height: number,
    tint: number,
    valid: boolean,
  ): void {
    // Tint toward the building's own colour when valid so the preview reads as the
    // thing being placed, and hard red when not so a refusal is unmissable.
    this.colour.setHex(valid ? tint : INVALID_COLOR).lerp(
      new Color(valid ? VALID_COLOR : INVALID_COLOR),
      valid ? 0.35 : 0,
    );
    this.mesh.material.color.copy(this.colour);
    this.place(x, y, w, h, height);
  }

  showErase(x: number, y: number, w: number, h: number, height: number): void {
    this.mesh.material.color.setHex(ERASE_COLOR);
    this.place(x, y, w, h, Math.max(height, 0.35));
  }

  private place(x: number, y: number, w: number, h: number, height: number): void {
    const centre = footprintCenter(x, y, w, h);
    this.mesh.position.set(centre.x, 0.02, centre.z);
    this.mesh.scale.set(w, height, h);
    this.mesh.visible = true;
  }
}
