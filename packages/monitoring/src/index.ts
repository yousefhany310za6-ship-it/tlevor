// ==================== Metrics ====================

export interface MetricOptions {
  name: string;
  help: string;
  labels?: string[];
}

export class Counter {
  private value: number = 0;
  private labelValues: Map<string, number> = new Map();
  constructor(private options: MetricOptions) {}

  inc(amount: number = 1, labels?: Record<string, string>): void {
    if (labels) {
      const key = JSON.stringify(labels);
      this.labelValues.set(key, (this.labelValues.get(key) || 0) + amount);
    } else {
      this.value += amount;
    }
  }

  getValue(labels?: Record<string, string>): number {
    if (labels) return this.labelValues.get(JSON.stringify(labels)) || 0;
    return this.value;
  }

  reset(): void { this.value = 0; this.labelValues.clear(); }
}

export class Gauge {
  private value: number = 0;
  private labelValues: Map<string, number> = new Map();
  constructor(private options: MetricOptions) {}

  set(value: number, labels?: Record<string, string>): void {
    if (labels) this.labelValues.set(JSON.stringify(labels), value);
    else this.value = value;
  }

  inc(amount: number = 1, labels?: Record<string, string>): void {
    const current = this.getValue(labels);
    this.set(current + amount, labels);
  }

  dec(amount: number = 1, labels?: Record<string, string>): void {
    const current = this.getValue(labels);
    this.set(current - amount, labels);
  }

  getValue(labels?: Record<string, string>): number {
    if (labels) return this.labelValues.get(JSON.stringify(labels)) || 0;
    return this.value;
  }

  reset(): void { this.value = 0; this.labelValues.clear(); }
}

export class Histogram {
  private buckets: Map<number, number> = new Map();
  private sum: number = 0;
  private count: number = 0;
  private labelValues: Map<string, { buckets: Map<number, number>; sum: number; count: number }> = new Map();

  constructor(private options: MetricOptions & { buckets?: number[] }) {
    const defaultBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
    for (const bucket of options.buckets || defaultBuckets) this.buckets.set(bucket, 0);
  }

  observe(value: number, labels?: Record<string, string>): void {
    if (labels) {
      const key = JSON.stringify(labels);
      if (!this.labelValues.has(key)) {
        const buckets = new Map<number, number>();
        for (const b of this.buckets.keys()) buckets.set(b, 0);
        this.labelValues.set(key, { buckets, sum: 0, count: 0 });
      }
      const lv = this.labelValues.get(key)!;
      lv.sum += value;
      lv.count++;
      for (const [bound, _] of lv.buckets) { if (value <= bound) lv.buckets.set(bound, lv.buckets.get(bound)! + 1); }
    } else {
      this.sum += value;
      this.count++;
      for (const [bound, _] of this.buckets) { if (value <= bound) this.buckets.set(bound, this.buckets.get(bound)! + 1); }
    }
  }

  getValue(): { buckets: Map<number, number>; sum: number; count: number } {
    return { buckets: new Map(this.buckets), sum: this.sum, count: this.count };
  }

  reset(): void {
    for (const key of this.buckets.keys()) this.buckets.set(key, 0);
    this.sum = 0;
    this.count = 0;
  }
}

// ==================== Registry ====================

export class MetricsRegistry {
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private histograms: Map<string, Histogram> = new Map();

  counter(options: MetricOptions): Counter {
    if (!this.counters.has(options.name)) this.counters.set(options.name, new Counter(options));
    return this.counters.get(options.name)!;
  }

  gauge(options: MetricOptions): Gauge {
    if (!this.gauges.has(options.name)) this.gauges.set(options.name, new Gauge(options));
    return this.gauges.get(options.name)!;
  }

  histogram(options: MetricOptions & { buckets?: number[] }): Histogram {
    if (!this.histograms.has(options.name)) this.histograms.set(options.name, new Histogram(options));
    return this.histograms.get(options.name)!;
  }

  formatPrometheus(): string {
    const lines: string[] = [];
    for (const [name, counter] of this.counters) {
      lines.push(`# HELP ${name} Counter`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${counter.getValue()}`);
    }
    for (const [name, gauge] of this.gauges) {
      lines.push(`# HELP ${name} Gauge`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${gauge.getValue()}`);
    }
    for (const [name, histogram] of this.histograms) {
      const { buckets, sum, count } = histogram.getValue();
      lines.push(`# HELP ${name} Histogram`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [le, val] of buckets) lines.push(`${name}_bucket{le="${le}"} ${val}`);
      lines.push(`${name}_sum ${sum}`);
      lines.push(`${name}_count ${count}`);
    }
    return lines.join('\n') + '\n';
  }

  reset(): void {
    for (const c of this.counters.values()) c.reset();
    for (const g of this.gauges.values()) g.reset();
    for (const h of this.histograms.values()) h.reset();
  }
}

// ==================== Middleware ====================

export function metricsMiddleware(registry: MetricsRegistry): { requestMiddleware: any; responseMiddleware: any } {
  const httpRequestsTotal = registry.counter({ name: 'http_requests_total', help: 'Total HTTP requests' });
  const httpRequestDuration = registry.histogram({ name: 'http_request_duration_seconds', help: 'Request duration' });
  const httpRequestsInFlight = registry.gauge({ name: 'http_requests_in_flight', help: 'In-flight requests' });

  const requestMiddleware = async (ctx: any) => {
    httpRequestsInFlight.inc();
    (ctx.state as any)._startTime = Date.now();
  };

  const responseMiddleware = async (ctx: any) => {
    httpRequestsInFlight.dec();
    const duration = ((Date.now() - ((ctx.state as any)._startTime || Date.now())) / 1000);
    httpRequestsTotal.inc(1, { method: ctx.req.method, status: String(ctx.res.statusCode) });
    httpRequestDuration.observe(duration, { method: ctx.req.method });
  };

  return { requestMiddleware, responseMiddleware };
}

// ==================== Factory ====================

export function createMetricsRegistry(): MetricsRegistry { return new MetricsRegistry(); }