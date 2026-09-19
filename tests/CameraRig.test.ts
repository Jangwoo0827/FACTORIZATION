import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/render/CameraRig';

const WIDTH = 1000;
const HEIGHT = 700;

function makeRig(yaw: number, pitch: number, zoom = 1): CameraRig {
  const rig = new CameraRig();
  rig.setViewport(WIDTH, HEIGHT);
  rig.lookAtTile(64, 64);
  // Drive yaw/pitch through the public API rather than poking private state.
  rig.rotateYaw(yaw - rig.yaw);
  rig.orbit(0, (pitch - rig.pitch) / 0.006);
  if (zoom !== 1) rig.zoomAt(zoom, null);
  return rig;
}

describe('CameraRig.panScreen', () => {
  // Every combination, because the earlier bug only showed at some angles: the
  // axes disagreed in sign, which a single default-angle check can hide.
  const yaws = [0, Math.PI / 4, Math.PI / 2, Math.PI, -1.1];
  const pitches = [0.45, 0.6155, 1.0, 1.4];
  const zooms = [0.5, 1, 2];

  for (const yaw of yaws) {
    for (const pitch of pitches) {
      for (const zoom of zooms) {
        const label = `yaw=${yaw.toFixed(2)} pitch=${pitch.toFixed(2)} zoom=${zoom}`;

        it(`keeps the grabbed ground point under the cursor — ${label}`, () => {
          const rig = makeRig(yaw, pitch, zoom);
          const grab = { x: 620, y: 410 };
          const before = rig.groundAt(grab)!;

          // Drag the cursor by (dx, dy) pixels: the grabbed point must follow it.
          const dx = 137;
          const dy = -84;
          rig.panScreen(dx, dy);

          const after = rig.groundAt({ x: grab.x + dx, y: grab.y + dy })!;
          expect(after.x).toBeCloseTo(before.x, 4);
          expect(after.z).toBeCloseTo(before.z, 4);
        });
      }
    }
  }

  it('moves the world the same way on both axes', () => {
    // Regression for the reported bug. Dragging right and dragging down must both
    // make the world follow the cursor; if one axis is inverted, exactly one of
    // these two ground-point shifts has the wrong sign relative to the drag.
    const rig = makeRig(Math.PI / 4, 0.6155);
    const centre = { x: WIDTH / 2, y: HEIGHT / 2 };

    const start = rig.groundAt(centre)!;
    rig.panScreen(80, 0);
    const afterRight = rig.groundAt(centre)!;
    const rightShift = { x: start.x - afterRight.x, z: start.z - afterRight.z };

    const rig2 = makeRig(Math.PI / 4, 0.6155);
    rig2.panScreen(0, 80);
    const afterDown = rig2.groundAt(centre)!;
    const downShift = { x: start.x - afterDown.x, z: start.z - afterDown.z };

    // Point under the centre after dragging right came FROM the left of the view,
    // so projecting each shift onto the screen axes must give +x and +y.
    const project = (v: { x: number; z: number }) => ({
      screenX: v.x * Math.cos(Math.PI / 4) - v.z * Math.sin(Math.PI / 4),
      screenY: -(v.x * Math.sin(Math.PI / 4) + v.z * Math.cos(Math.PI / 4)),
    });

    expect(project(rightShift).screenX).toBeGreaterThan(0);
    expect(project(downShift).screenY).toBeLessThan(0);
  });
});

describe('CameraRig.orbit', () => {
  it('tips toward a top-down view when dragged down', () => {
    const rig = makeRig(0, 0.7);
    const before = rig.pitch;
    rig.orbit(0, 60);
    expect(rig.pitch).toBeGreaterThan(before);
  });

  it('tips toward the horizon when dragged up', () => {
    const rig = makeRig(0, 0.7);
    const before = rig.pitch;
    rig.orbit(0, -60);
    expect(rig.pitch).toBeLessThan(before);
  });

  it('spins the scene with the cursor when dragged sideways', () => {
    const rig = makeRig(0, 0.7);
    const before = rig.yaw;
    rig.orbit(60, 0);
    // Dragging right decreases yaw, which is what turns the scene right.
    expect(rig.yaw).toBeLessThan(before);
  });

  it('clamps the elevation at both ends', () => {
    const rig = makeRig(0, 0.7);
    rig.orbit(0, 100000);
    expect(rig.pitch).toBeLessThanOrEqual((85 * Math.PI) / 180 + 1e-9);
    rig.orbit(0, -100000);
    expect(rig.pitch).toBeGreaterThanOrEqual((22 * Math.PI) / 180 - 1e-9);
  });
});

describe('CameraRig.panGround', () => {
  it('moves forward up the screen, whatever the yaw', () => {
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, 2.4, -1.3]) {
      const rig = makeRig(yaw, 0.6155);
      const centre = { x: WIDTH / 2, y: HEIGHT / 2 };
      const above = { x: WIDTH / 2, y: HEIGHT / 2 - 100 };

      // The ground point currently 100px above the centre is what "forward"
      // should bring to the centre.
      const target = rig.groundAt(above)!;
      const c = rig.groundAt(centre)!;
      const dist = Math.hypot(target.x - c.x, target.z - c.z);

      rig.panGround(0, dist);
      const now = rig.groundAt(centre)!;
      expect(now.x).toBeCloseTo(target.x, 4);
      expect(now.z).toBeCloseTo(target.z, 4);
    }
  });

  it('moves right toward the right of the screen, whatever the yaw', () => {
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, 2.4, -1.3]) {
      const rig = makeRig(yaw, 0.6155);
      const centre = { x: WIDTH / 2, y: HEIGHT / 2 };
      const right = { x: WIDTH / 2 + 100, y: HEIGHT / 2 };

      const target = rig.groundAt(right)!;
      const c = rig.groundAt(centre)!;
      const dist = Math.hypot(target.x - c.x, target.z - c.z);

      rig.panGround(dist, 0);
      const now = rig.groundAt(centre)!;
      expect(now.x).toBeCloseTo(target.x, 4);
      expect(now.z).toBeCloseTo(target.z, 4);
    }
  });
});
