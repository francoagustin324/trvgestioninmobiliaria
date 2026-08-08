export type SerialWorker<T> = (value: T) => Promise<void>;
export type SerialLatestResolver<T> = (completed: T) => T | null;

interface QueueWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Serializa escrituras y colapsa trabajo pendiente al snapshot más reciente.
 * Nunca ejecuta más de un worker simultáneo. Los callers esperan a que la cola
 * quede drenada, no solamente a que termine la generación que la inició.
 */
export class LatestSerialQueue<T> {
  private running = false;
  private pending: T | null = null;
  private waiters: QueueWaiter[] = [];

  constructor(
    private readonly worker: SerialWorker<T>,
    private readonly latestAfter?: SerialLatestResolver<T>,
  ) {}

  enqueue(value: T): Promise<void> {
    this.pending = value;
    const completion = new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
    if (!this.running) void this.drain();
    return completion;
  }

  isRunning(): boolean {
    return this.running;
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  private settleSuccess(): void {
    const waiters = this.waiters.splice(0);
    waiters.forEach((waiter) => waiter.resolve());
  }

  private settleFailure(error: unknown): void {
    const waiters = this.waiters.splice(0);
    waiters.forEach((waiter) => waiter.reject(error));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending !== null) {
        const current = this.pending;
        this.pending = null;
        await this.worker(current);
        const automaticLatest = this.latestAfter?.(current) ?? null;
        if (automaticLatest !== null) this.pending = automaticLatest;
      }
      this.settleSuccess();
    } catch (error) {
      this.pending = null;
      this.settleFailure(error);
    } finally {
      this.running = false;
      // Una llamada puede entrar entre el último chequeo y el finally.
      if (this.pending !== null) void this.drain();
    }
  }
}
