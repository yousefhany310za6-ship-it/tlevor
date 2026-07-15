// ==================== Types ====================

export interface JobOptions {
  delay?: number;
  attempts?: number;
  backoff?: number | { type: 'fixed' | 'exponential'; delay: number };
  priority?: number;
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
  timeout?: number;
}

export interface Job<T = any> {
  id: string;
  name: string;
  data: T;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
  progress: number;
  result?: any;
  error?: string;
  attempts: number;
  maxAttempts: number;
  priority?: number;
  createdAt: number;
  processedAt?: number;
  completedAt?: number;
  failedAt?: number;
}

export type JobProcessor<T = any> = (job: Job<T>) => Promise<any>;

export interface QueueEvents {
  'job:added': (job: Job) => void;
  'job:completed': (job: Job) => void;
  'job:failed': (job: Job, error: Error) => void;
  'job:progress': (job: Job, progress: number) => void;
  'queue:drained': () => void;
}

// ==================== Memory Queue ====================

export class MemoryQueue {
  private name: string;
  private jobs: Map<string, Job> = new Map();
  private processors: Map<string, JobProcessor> = new Map();
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private concurrency: number;
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private eventListeners: Map<string, Function[]> = new Map();

  constructor(name: string, options: { concurrency?: number } = {}) {
    this.name = name;
    this.concurrency = options.concurrency || 1;
  }

  getName(): string { return this.name; }

  async add<T = any>(name: string, data: T, options: JobOptions = {}): Promise<Job<T>> {
    const id = `${this.name}:${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const job: Job<T> = {
      id,
      name,
      data,
      status: this.isPaused ? 'paused' : (options.delay ? 'delayed' : 'waiting'),
      progress: 0,
      attempts: 0,
      maxAttempts: options.attempts || 3,
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    this.emit('job:added', job);

    if (options.delay) {
      const timer = setTimeout(() => {
        job.status = 'waiting';
        this.timers.delete(id);
        this.processNext();
      }, options.delay);
      this.timers.set(id, timer);
    } else {
      this.processNext();
    }

    return job;
  }

  process(name: string, processor: JobProcessor): void {
    this.processors.set(name, processor);
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const waitingJobs = Array.from(this.jobs.values())
      .filter(j => j.status === 'waiting')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    let processed = 0;
    for (const job of waitingJobs) {
      if (processed >= this.concurrency) break;
      const processor = this.processors.get(job.name);
      if (!processor) continue;

      job.status = 'active';
      job.attempts++;
      job.processedAt = Date.now();
      processed++;

      try {
        const result = await processor(job);
        job.status = 'completed';
        job.result = result;
        job.completedAt = Date.now();
        this.emit('job:completed', job);
      } catch (error: any) {
        if (job.attempts < job.maxAttempts) {
          job.status = 'waiting';
          job.error = error.message;
        } else {
          job.status = 'failed';
          job.error = error.message;
          job.failedAt = Date.now();
          this.emit('job:failed', job, error);
        }
      }
    }

    this.isProcessing = false;
    const hasRetries = Array.from(this.jobs.values()).some(j => j.status === 'waiting' && j.attempts > 0);
    if (hasRetries) {
      setTimeout(() => this.processNext(), 10);
    } else if (waitingJobs.length === 0) {
      this.emit('queue:drained');
    }
  }

  async getJob(id: string): Promise<Job | null> { return this.jobs.get(id) || null; }

  async getJobs(status?: Job['status']): Promise<Job[]> {
    const jobs = Array.from(this.jobs.values());
    return status ? jobs.filter(j => j.status === status) : jobs;
  }

  async removeJob(id: string): Promise<boolean> {
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
    return this.jobs.delete(id);
  }

  async clean(maxAge: number = 3600000): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, job] of this.jobs) {
      if ((job.status === 'completed' || job.status === 'failed') && job.completedAt && (now - job.completedAt) > maxAge) {
        this.jobs.delete(id);
        count++;
      }
    }
    return count;
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    for (const job of this.jobs.values()) {
      if (job.status === 'waiting') job.status = 'paused';
    }
  }

  async resume(): Promise<void> {
    this.isPaused = false;
    for (const job of this.jobs.values()) {
      if (job.status === 'paused') job.status = 'waiting';
    }
    this.processNext();
  }

  async getJobCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const job of this.jobs.values()) {
      counts[job.status] = (counts[job.status] || 0) + 1;
    }
    return counts;
  }

  on<K extends keyof QueueEvents>(event: K, handler: QueueEvents[K]): void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event)!.push(handler as Function);
  }

  private emit(event: string, ...args: any[]): void {
    const handlers = this.eventListeners.get(event) || [];
    for (const handler of handlers) handler(...args);
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

// ==================== Worker ====================

export interface WorkerOptions {
  concurrency?: number;
  limiter?: { max: number; duration: number };
}

export class Worker {
  private queue: MemoryQueue;
  private options: Required<WorkerOptions>;

  constructor(queue: MemoryQueue, options: WorkerOptions = {}) {
    this.queue = queue;
    this.options = {
      concurrency: options.concurrency || 1,
      limiter: options.limiter || { max: Infinity, duration: 0 },
    };
  }

  process(name: string, processor: JobProcessor): void {
    this.queue.process(name, processor);
  }

  getQueue(): MemoryQueue { return this.queue; }
}

// ==================== Repeatable Jobs ====================

export interface RepeatOptions {
  every?: number;
  cron?: string;
}

export class RepeatScheduler {
  private queue: MemoryQueue;
  private jobs: Map<string, { timer: ReturnType<typeof setInterval>; name: string; data: any }> = new Map();

  constructor(queue: MemoryQueue) { this.queue = queue; }

  add(name: string, data: any, options: RepeatOptions): string {
    const id = `repeat:${name}:${Date.now()}`;
    const interval = options.every || 60000;
    const timer = setInterval(() => { this.queue.add(name, data); }, interval);
    this.jobs.set(id, { timer, name, data });
    return id;
  }

  remove(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    clearInterval(job.timer);
    return this.jobs.delete(id);
  }

  async close(): Promise<void> {
    for (const job of this.jobs.values()) clearInterval(job.timer);
    this.jobs.clear();
  }
}

// ==================== Factory ====================

export function createQueue(name: string, options?: { concurrency?: number }): MemoryQueue {
  return new MemoryQueue(name, options);
}