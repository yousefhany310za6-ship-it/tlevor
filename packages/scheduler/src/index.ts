// ==================== Cron Parser ====================

export interface CronExpression {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export function parseCron(expression: string): CronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expression}. Expected 5 fields.`);
  return {
    minute: parts[0],
    hour: parts[1],
    dayOfMonth: parts[2],
    month: parts[3],
    dayOfWeek: parts[4],
  };
}

function matchField(field: string, value: number): boolean {
  if (field === '*') return true;
  if (field.includes(',')) return field.split(',').some(f => matchField(f.trim(), value));
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return value >= start && value <= end;
  }
  if (field.includes('/')) {
    const [start, step] = field.split('/');
    const startVal = start === '*' ? 0 : Number(start);
    return (value - startVal) % Number(step) === 0 && value >= startVal;
  }
  return Number(field) === value;
}

export function cronMatches(expr: CronExpression, date: Date): boolean {
  return (
    matchField(expr.minute, date.getMinutes()) &&
    matchField(expr.hour, date.getHours()) &&
    matchField(expr.dayOfMonth, date.getDate()) &&
    matchField(expr.month, date.getMonth() + 1) &&
    matchField(expr.dayOfWeek, date.getDay())
  );
}

export function getNextCronDate(expression: string, from: Date = new Date()): Date {
  const expr = parseCron(expression);
  const next = new Date(from);
  next.setSeconds(0);
  next.setMilliseconds(0);

  for (let i = 0; i < 366 * 24 * 60; i++) {
    next.setMinutes(next.getMinutes() + 1);
    if (cronMatches(expr, next)) return next;
  }
  throw new Error('Could not find next cron date within 1 year');
}

// ==================== Scheduler ====================

export interface ScheduledTask {
  id: string;
  name: string;
  cron?: string;
  interval?: number;
  handler: () => Promise<void> | void;
  running: boolean;
  lastRun?: number;
  nextRun?: number;
  enabled: boolean;
}

export class Scheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  schedule(name: string, cron: string, handler: () => Promise<void> | void): string {
    const id = `task:${name}:${Date.now()}`;
    const nextRun = getNextCronDate(cron).getTime();
    const task: ScheduledTask = { id, name, cron, handler, running: false, nextRun, enabled: true };
    this.tasks.set(id, task);
    this.scheduleNext(task);
    return id;
  }

  interval(name: string, ms: number, handler: () => Promise<void> | void): string {
    const id = `task:${name}:${Date.now()}`;
    const task: ScheduledTask = { id, name, interval: ms, handler, running: false, enabled: true };
    this.tasks.set(id, task);
    const timer = setInterval(async () => {
      if (!task.enabled || task.running) return;
      task.running = true;
      task.lastRun = Date.now();
      try { await handler(); } finally { task.running = false; }
    }, ms);
    this.intervals.set(id, timer);
    return id;
  }

  timeout(name: string, ms: number, handler: () => Promise<void> | void): string {
    const id = `task:${name}:${Date.now()}`;
    const task: ScheduledTask = { id, name, interval: ms, handler, running: false, enabled: true };
    this.tasks.set(id, task);
    const timer = setTimeout(async () => {
      task.running = true;
      task.lastRun = Date.now();
      try { await handler(); } finally { task.running = false; this.tasks.delete(id); }
    }, ms);
    this.timers.set(id, timer);
    return id;
  }

  private scheduleNext(task: ScheduledTask): void {
    if (!task.cron || !task.enabled) return;
    const nextRun = getNextCronDate(task.cron);
    task.nextRun = nextRun.getTime();
    const delay = nextRun.getTime() - Date.now();
    const timer = setTimeout(async () => {
      task.running = true;
      task.lastRun = Date.now();
      try { await task.handler(); } finally { task.running = false; this.scheduleNext(task); }
    }, Math.max(0, delay));
    this.timers.set(task.id, timer);
  }

  getTask(id: string): ScheduledTask | undefined { return this.tasks.get(id); }
  getTasks(): ScheduledTask[] { return Array.from(this.tasks.values()); }

  pause(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.enabled = false;
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
    const interval = this.intervals.get(id);
    if (interval) clearInterval(interval);
    return true;
  }

  resume(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    task.enabled = true;
    if (task.cron) this.scheduleNext(task);
    else if (task.interval) {
      const timer = setInterval(async () => {
        if (!task.enabled || task.running) return;
        task.running = true;
        task.lastRun = Date.now();
        try { await task.handler(); } finally { task.running = false; }
      }, task.interval);
      this.intervals.set(id, timer);
    }
    return true;
  }

  remove(id: string): boolean {
    this.pause(id);
    return this.tasks.delete(id);
  }

  async close(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const interval of this.intervals.values()) clearInterval(interval);
    this.timers.clear();
    this.intervals.clear();
    this.tasks.clear();
  }
}

// ==================== Factory ====================

export function createScheduler(): Scheduler { return new Scheduler(); }