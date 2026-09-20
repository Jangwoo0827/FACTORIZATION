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
/**
 * How long one call may spend running ticks while the game is on screen. Capped so
 * simulating never starves drawing: whatever is left stays owed for the next call.
 */
export const SIM_BUDGET_FOREGROUND_MS = 10;
/** The same while the page is hidden, when nothing is being drawn and no frame is waiting. */
export const SIM_BUDGET_HIDDEN_MS = 100;
/**
 * Real time that may be owed while the game is running normally before the excess
 * is dropped. Past this the machine is simply too slow, so the game runs slower
 * than real time rather than chasing a backlog.
 */
export const SIM_LIVE_BACKLOG_SECONDS = 1;
/**
 * Longest single stretch of away time (a frozen tab, a sleeping machine) that is
 * caught up on return, so the factory has kept running for that long.
 */
export const SIM_AWAY_CATCHUP_SECONDS = 30 * 60;
/** A gap between updates longer than this is time spent away, not lag. */
export const SIM_AWAY_THRESHOLD_SECONDS = 0.5;
/** Show a "catching up" notice once this much time is owed. */
export const SIM_CATCHUP_NOTICE_SECONDS = 1.5;

/** Conveyor Mk1 speed (GDD 7.1). With 4 items per tile at 0.25 spacing this carries 6 items/s. */
export const BELT_SPEED_MK1 = 1.5;
/** Ore a Mk1 miner yields per second for each ore tile under it (GDD 6.1: 4 tiles = 0.5/s). */
export const MINER_MK1_RATE_PER_TILE = 0.125;
/** Items a miner holds while its output belt is blocked. */
export const MINER_BUFFER = 5;
/** Hub stock ceiling per item (GDD 6.3). Deliveries past it still count toward missions. */
export const HUB_STOCK_CAP = 9999;

/** Tiles per second the camera travels under keyboard panning. */
export const KEYBOARD_PAN_TILES_PER_SEC = 24;

export const DEFAULT_SEED = 20260919;
