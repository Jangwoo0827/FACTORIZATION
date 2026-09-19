/** Screen width of one ground tile's diamond, in pixels. */
export const TILE_W = 64;
/** Screen height of one ground tile's diamond, in pixels. 2:1 isometric. */
export const TILE_H = 32;

/** Map edge length in tiles (GDD 4.2: 128x128 for the MVP). */
export const MAP_SIZE = 128;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
export const DEFAULT_ZOOM = 1;

/** Simulation rate (GDD 14.3). Rendering stays at display rate. */
export const SIM_TPS = 30;

/** Radius, in tiles, of the build grid drawn around the cursor while a tool is held. */
export const GRID_HALO_RADIUS = 14;

/** Tiles per second the camera travels under keyboard panning. */
export const KEYBOARD_PAN_TILES_PER_SEC = 14;

export const DEFAULT_SEED = 20260919;
