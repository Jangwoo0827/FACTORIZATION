/** One tile is one world unit. The 3D grid lies on the XZ plane, Y is up. */
export const TILE = 1;

/** Map edge length in tiles (GDD 4.2). */
export const MAP_SIZE = 128;

/**
 * Orthographic zoom, expressed as the vertical extent of the view in world units
 * (i.e. how many tiles tall the screen is). Smaller = closer.
 */
export const MIN_VIEW_SIZE = 8;
export const MAX_VIEW_SIZE = 180;
export const DEFAULT_VIEW_SIZE = 44;

/**
 * Camera elevation. The default is true isometric, atan(1/sqrt(2)) — every axis
 * foreshortens equally, which is the angle the 2D version was imitating.
 * Clamped away from the extremes: near 0 the ground vanishes, near 90 it reads
 * as a flat top-down map and the buildings lose their silhouettes.
 */
export const DEFAULT_PITCH = Math.atan(1 / Math.SQRT2);
/**
 * 22 degrees, not lower. A near-horizon view of a factory hides most of it behind
 * whatever is in front, which works against the game's first pillar, and it makes
 * ground decals graze the depth buffer.
 */
export const MIN_PITCH = (22 * Math.PI) / 180;
export const MAX_PITCH = (85 * Math.PI) / 180;

/** Default yaw puts the map corner toward the viewer, as the 2D projection did. */
export const DEFAULT_YAW = Math.PI / 4;
/** Radians per second while Q or E is held. */
export const YAW_SPEED = Math.PI * 0.6;
/** Step taken by the on-screen rotate buttons. */
export const YAW_STEP = Math.PI / 4;

/**
 * Orthographic cameras take their scale from the frustum, not the distance, so
 * this only has to clear the scene for the near plane.
 */
export const CAMERA_DISTANCE = 400;

/** Simulation rate (GDD 14.3). Rendering runs at display rate. */
export const SIM_TPS = 30;

/** Tiles per second the camera travels under keyboard panning. */
export const KEYBOARD_PAN_TILES_PER_SEC = 24;

export const DEFAULT_SEED = 20260919;
