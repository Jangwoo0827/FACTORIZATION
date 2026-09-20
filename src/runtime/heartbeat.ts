/**
 * A timer that keeps firing while the page is hidden.
 *
 * Browsers stop animation frames for a hidden tab and slow ordinary timers to once
 * a second, and after a few minutes to once a minute. A timer running inside a Web
 * Worker is exempt from that throttling, so the worker fires at full rate and posts
 * a message to the main thread each time. Messages are delivered promptly even to a
 * hidden page, which is what lets the factory keep running behind other windows.
 *
 * This only wakes the game up. How many ticks to run is decided from the real clock
 * by `SimClock`, so nothing here needs to be precise or reliable: if the worker is
 * unavailable, or the browser delays it anyway, the next beat simply finds more
 * time owed and catches up.
 */

export interface HeartbeatEnvironment {
  Worker?: typeof Worker;
  Blob: typeof Blob;
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export class Heartbeat {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param intervalMs how often to beat
   * @param onBeat called on the main thread for each beat
   * @param env the browser's globals, injectable so the fallback can be tested
   */
  constructor(
    private readonly intervalMs: number,
    private readonly onBeat: () => void,
    private readonly env: HeartbeatEnvironment = globalThis as unknown as HeartbeatEnvironment,
  ) {}

  /** True when beats come from a worker, i.e. they survive the tab being hidden. */
  get usesWorker(): boolean {
    return this.worker !== null;
  }

  start(): void {
    if (this.worker || this.timer !== null) return;

    try {
      this.startWorker();
    } catch {
      // No Worker, blocked blob: URLs, or a policy that forbids either. A plain
      // timer still beats; it is merely throttled when hidden, and the clock makes
      // up the difference on the next beat.
      this.cleanupWorker();
      this.timer = this.env.setInterval(this.onBeat, this.intervalMs);
    }
  }

  stop(): void {
    this.cleanupWorker();
    if (this.timer !== null) {
      this.env.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startWorker(): void {
    const WorkerClass = this.env.Worker;
    if (!WorkerClass) throw new Error('Worker is not available');

    // An inline worker built from a string, not a separate file: nothing extra to
    // bundle or serve, and it works unchanged from a dev server or a static host.
    const source = `setInterval(() => postMessage(0), ${this.intervalMs});`;
    const url = this.env.URL.createObjectURL(new this.env.Blob([source], { type: 'text/javascript' }));
    this.workerUrl = url;

    const worker = new WorkerClass(url);
    worker.onmessage = () => this.onBeat();
    // A worker that fails to load (a CSP that allows the constructor but blocks the
    // script) reports through onerror instead of throwing. Fall back then too.
    worker.onerror = () => {
      this.cleanupWorker();
      if (this.timer === null) this.timer = this.env.setInterval(this.onBeat, this.intervalMs);
    };
    this.worker = worker;
  }

  private cleanupWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    if (this.workerUrl) {
      this.env.URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
  }
}
