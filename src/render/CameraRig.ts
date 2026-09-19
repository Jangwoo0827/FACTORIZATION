/**
 * Orthographic orbit camera (GDD 4.1).
 *
 * Orthographic, not perspective, on purpose: the game's first pillar is that the
 * flow through the factory is readable at a glance, and perspective foreshortening
 * plus occlusion works against exactly that. This keeps the legible "isometric"
 * look while the third dimension buys free rotation and z-buffer depth sorting.
 *
 * Zoom is the frustum's vertical extent in world units, not a distance — moving an
 * orthographic camera closer changes nothing about what it sees.
 */

import {
  MathUtils,
  OrthographicCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import {
  CAMERA_DISTANCE,
  MAP_SIZE,
  DEFAULT_PITCH,
  DEFAULT_VIEW_SIZE,
  DEFAULT_YAW,
  MAX_PITCH,
  MAX_VIEW_SIZE,
  MIN_PITCH,
  MIN_VIEW_SIZE,
} from '../config';
import type { Vec2 } from '../core/grid';

const GROUND = new Plane(new Vector3(0, 1, 0), 0);

/** Orbit sensitivity. One full screen-height drag turns the view about 70 degrees. */
const ORBIT_RADIANS_PER_PIXEL = 0.006;

export class CameraRig {
  readonly camera: OrthographicCamera;

  /** Point on the ground the camera looks at and orbits around. */
  private readonly target = new Vector3();
  private yawAngle = DEFAULT_YAW;
  private pitchAngle = DEFAULT_PITCH;
  private viewSize = DEFAULT_VIEW_SIZE;

  private viewportWidth = 1;
  private viewportHeight = 1;

  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly scratch = new Vector3();

  constructor() {
    // Depth range is kept as tight as the map allows. An orthographic depth buffer
    // is linear, so precision is range/2^24 everywhere — a loose range makes ground
    // decals z-fight with the ground at shallow angles. Half the map's diagonal is
    // the most any visible point can sit in front of or behind the focus point.
    const halfDepth = MAP_SIZE * 1.6;
    this.camera = new OrthographicCamera(
      -1,
      1,
      1,
      -1,
      CAMERA_DISTANCE - halfDepth,
      CAMERA_DISTANCE + halfDepth,
    );
    this.apply();
  }

  get yaw(): number {
    return this.yawAngle;
  }

  get pitch(): number {
    return this.pitchAngle;
  }

  get zoom(): number {
    return this.viewSize;
  }

  lookAtTile(tx: number, ty: number): void {
    this.target.set(tx, 0, ty);
    this.apply();
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.apply();
  }

  /**
   * Drags the ground under the cursor: whatever point you grabbed stays under the
   * pointer for the whole drag.
   *
   * Both axes must obey that. Having one axis follow the cursor while the other
   * opposed it is what made the camera feel wrong, and it reads as "the Y axis is
   * inverted" because the horizontal axis is the one that looked right.
   * `tests/CameraRig.test.ts` pins the invariant against the real projection.
   */
  panScreen(dx: number, dy: number): void {
    const perPixel = this.viewSize / this.viewportHeight;
    const cosYaw = Math.cos(this.yawAngle);
    const sinYaw = Math.sin(this.yawAngle);

    // The ground is foreshortened vertically by sin(pitch), so a pixel of vertical
    // drag covers more ground the shallower the camera sits. Dividing by it is
    // what keeps the grabbed point pinned rather than sliding.
    const depthPerPixel = perPixel / Math.max(Math.sin(this.pitchAngle), 0.15);

    // Screen right on the ground is (cos, 0, -sin); screen up is -(sin, 0, cos).
    // The focus point moves opposite the drag, so the world moves with it.
    this.target.x -= cosYaw * dx * perPixel;
    this.target.z += sinYaw * dx * perPixel;
    this.target.x -= sinYaw * dy * depthPerPixel;
    this.target.z -= cosYaw * dy * depthPerPixel;

    this.apply();
  }

  /** Moves the focus point in tiles, relative to the current yaw. Keyboard pan. */
  panGround(right: number, forward: number): void {
    const cosYaw = Math.cos(this.yawAngle);
    const sinYaw = Math.sin(this.yawAngle);
    this.target.x += right * cosYaw - forward * sinYaw;
    this.target.z += -right * sinYaw - forward * cosYaw;
    this.apply();
  }

  /**
   * Turns the camera from a screen drag, following the three.js OrbitControls
   * convention that most people already have in their hands: the near face of the
   * scene follows the cursor. Dragging right spins the scene right; dragging down
   * tips its top toward you, so you end up looking more from above.
   */
  orbit(dx: number, dy: number): void {
    this.yawAngle -= dx * ORBIT_RADIANS_PER_PIXEL;
    this.pitchAngle = MathUtils.clamp(
      this.pitchAngle + dy * ORBIT_RADIANS_PER_PIXEL,
      MIN_PITCH,
      MAX_PITCH,
    );
    this.apply();
  }

  rotateYaw(delta: number): void {
    this.yawAngle += delta;
    this.apply();
  }

  /**
   * Scales the zoom while holding the ground point under `screen` still, so the
   * wheel pulls toward the cursor instead of the screen centre.
   */
  zoomAt(factor: number, screen: Vec2 | null): void {
    const next = MathUtils.clamp(this.viewSize / factor, MIN_VIEW_SIZE, MAX_VIEW_SIZE);
    if (next === this.viewSize) return;

    const before = screen ? this.groundAt(screen) : null;
    this.viewSize = next;
    this.apply();

    if (!before) return;
    const after = this.groundAt(screen!);
    if (!after) return;
    this.target.x += before.x - after.x;
    this.target.z += before.z - after.z;
    this.apply();
  }

  /** Screen point -> the ground point under it, or null if the ray misses. */
  groundAt(screen: Vec2): Vector3 | null {
    this.ndc.set(
      (screen.x / this.viewportWidth) * 2 - 1,
      -(screen.y / this.viewportHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(GROUND, this.scratch);
    return hit ? hit.clone() : null;
  }

  /** Ground point at the centre of the screen — the anchor when the view turns. */
  centreGround(): Vector3 {
    return this.target.clone();
  }

  private apply(): void {
    const aspect = this.viewportWidth / this.viewportHeight;
    const halfH = this.viewSize / 2;
    const halfW = halfH * aspect;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

    const cosPitch = Math.cos(this.pitchAngle);
    this.camera.position.set(
      this.target.x + Math.sin(this.yawAngle) * cosPitch * CAMERA_DISTANCE,
      this.target.y + Math.sin(this.pitchAngle) * CAMERA_DISTANCE,
      this.target.z + Math.cos(this.yawAngle) * cosPitch * CAMERA_DISTANCE,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
