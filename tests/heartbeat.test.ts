import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Heartbeat, type HeartbeatEnvironment } from '../src/runtime/heartbeat';

/** A stand-in Worker that records how it was built and lets a test fire its events. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  constructor(readonly url: string) {
    FakeWorker.instances.push(this);
  }
  terminate(): void {
    this.terminated = true;
  }
  beat(): void {
    this.onmessage?.({});
  }
}

function makeEnv(overrides: Partial<HeartbeatEnvironment> = {}): HeartbeatEnvironment & {
  revoked: string[];
  blobs: string[][];
} {
  const revoked: string[] = [];
  const blobs: string[][] = [];
  return {
    Worker: FakeWorker as unknown as typeof Worker,
    Blob: class {
      constructor(parts: string[]) {
        blobs.push(parts);
      }
    } as unknown as typeof Blob,
    URL: {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: (u: string) => void revoked.push(u),
    },
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    revoked,
    blobs,
    ...overrides,
  };
}

describe('Heartbeat', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('with a worker', () => {
    it('beats on the main thread whenever the worker posts a message', () => {
      const onBeat = vi.fn();
      const beat = new Heartbeat(33, onBeat, makeEnv());
      beat.start();

      expect(beat.usesWorker).toBe(true);
      FakeWorker.instances[0]!.beat();
      FakeWorker.instances[0]!.beat();
      expect(onBeat).toHaveBeenCalledTimes(2);
    });

    it('does not use a main-thread timer, which is what the browser throttles', () => {
      const setIntervalSpy = vi.fn();
      const beat = new Heartbeat(33, vi.fn(), makeEnv({ setInterval: setIntervalSpy as never }));
      beat.start();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('builds the worker from an inline script at the requested interval', () => {
      const env = makeEnv();
      new Heartbeat(33, vi.fn(), env).start();

      expect(env.blobs).toHaveLength(1);
      expect(env.blobs[0]![0]).toContain('setInterval');
      expect(env.blobs[0]![0]).toContain('33');
    });

    it('terminates the worker and frees its script on stop', () => {
      const env = makeEnv();
      const beat = new Heartbeat(33, vi.fn(), env);
      beat.start();
      beat.stop();

      expect(FakeWorker.instances[0]!.terminated).toBe(true);
      expect(env.revoked).toEqual(['blob:fake']);
      expect(beat.usesWorker).toBe(false);
    });

    it('does not beat after it is stopped', () => {
      const onBeat = vi.fn();
      const beat = new Heartbeat(33, onBeat, makeEnv());
      beat.start();
      const worker = FakeWorker.instances[0]!;
      beat.stop();

      worker.beat();
      expect(onBeat).not.toHaveBeenCalled();
    });

    it('starting twice does not create a second worker', () => {
      const beat = new Heartbeat(33, vi.fn(), makeEnv());
      beat.start();
      beat.start();
      expect(FakeWorker.instances).toHaveLength(1);
    });
  });

  describe('falling back to a plain timer', () => {
    it('when there is no Worker at all', () => {
      const onBeat = vi.fn();
      const beat = new Heartbeat(33, onBeat, makeEnv({ Worker: undefined }));
      beat.start();

      expect(beat.usesWorker).toBe(false);
      vi.advanceTimersByTime(100);
      expect(onBeat).toHaveBeenCalledTimes(3);
    });

    it('when the worker constructor throws', () => {
      class Throwing {
        constructor() {
          throw new Error('blocked by policy');
        }
      }
      const env = makeEnv({ Worker: Throwing as unknown as typeof Worker });
      const onBeat = vi.fn();
      const beat = new Heartbeat(33, onBeat, env);
      beat.start();

      vi.advanceTimersByTime(100);
      expect(onBeat).toHaveBeenCalledTimes(3);
      // The script URL made before the constructor threw is not leaked.
      expect(env.revoked).toEqual(['blob:fake']);
    });

    it('when the worker loads but then fails, which is how a blocking CSP reports', () => {
      const onBeat = vi.fn();
      const env = makeEnv();
      const beat = new Heartbeat(33, onBeat, env);
      beat.start();
      expect(beat.usesWorker).toBe(true);

      FakeWorker.instances[0]!.onerror?.({});

      expect(beat.usesWorker).toBe(false);
      expect(FakeWorker.instances[0]!.terminated).toBe(true);
      vi.advanceTimersByTime(100);
      expect(onBeat).toHaveBeenCalledTimes(3);
    });

    it('clears the fallback timer on stop', () => {
      const onBeat = vi.fn();
      const beat = new Heartbeat(33, onBeat, makeEnv({ Worker: undefined }));
      beat.start();
      beat.stop();

      vi.advanceTimersByTime(500);
      expect(onBeat).not.toHaveBeenCalled();
    });
  });
});
