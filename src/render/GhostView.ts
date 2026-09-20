/**
 * The translucent preview of what a click would build, and the highlight shown
 * over what a click would remove.
 */

import { BoxGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, Scene } from 'three';
import { footprintCenter } from '../core/grid';
import { arrowRotation, createArrowGeometry } from './arrow';

const VALID_COLOR = 0x8fe08a;
const INVALID_COLOR = 0xe4635c;
const ERASE_COLOR = 0xe4635c;

export class GhostView {
  private readonly mesh: Mesh<BoxGeometry, MeshBasicMaterial>;
  private readonly arrow: Mesh<ReturnType<typeof createArrowGeometry>, MeshBasicMaterial>;
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

    // Drawn on top of everything so the direction stays readable even when the
    // preview sits partly inside a building or another belt.
    this.arrow = new Mesh(
      createArrowGeometry(),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        side: DoubleSide,
        depthTest: false,
      }),
    );
    this.arrow.visible = false;
    this.arrow.renderOrder = 11;
    scene.add(this.arrow);
  }

  hide(): void {
    this.mesh.visible = false;
    this.arrow.visible = false;
  }

  /**
   * `arrowDir` is the direction a belt would carry items, or null for buildings
   * that have none.
   */
  showBuilding(
    x: number,
    y: number,
    w: number,
    h: number,
    height: number,
    tint: number,
    valid: boolean,
    arrowDir: number | null = null,
  ): void {
    // Tint toward the building's own colour when valid so the preview reads as the
    // thing being placed, and hard red when not so a refusal is unmissable.
    this.colour.setHex(valid ? tint : INVALID_COLOR).lerp(
      new Color(valid ? VALID_COLOR : INVALID_COLOR),
      valid ? 0.35 : 0,
    );
    this.mesh.material.color.copy(this.colour);
    this.place(x, y, w, h, height);

    if (arrowDir === null) {
      this.arrow.visible = false;
      return;
    }
    const centre = footprintCenter(x, y, w, h);
    this.arrow.position.set(centre.x, height + 0.03, centre.z);
    arrowRotation(arrowDir, this.arrow.quaternion);
    this.arrow.visible = true;
  }

  showErase(x: number, y: number, w: number, h: number, height: number): void {
    this.mesh.material.color.setHex(ERASE_COLOR);
    this.place(x, y, w, h, Math.max(height, 0.35));
    this.arrow.visible = false;
  }

  private place(x: number, y: number, w: number, h: number, height: number): void {
    const centre = footprintCenter(x, y, w, h);
    this.mesh.position.set(centre.x, 0.02, centre.z);
    this.mesh.scale.set(w, height, h);
    this.mesh.visible = true;
  }
}
