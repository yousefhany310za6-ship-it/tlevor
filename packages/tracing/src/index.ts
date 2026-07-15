import { randomUUID } from 'crypto';

// ==================== Types ====================

export interface SpanOptions {
  name: string;
  parentSpanId?: string;
  attributes?: Record<string, string | number | boolean>;
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'OK' | 'ERROR' | 'UNSET';
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
}

// ==================== Tracer ====================

export class Tracer {
  private spans: Map<string, Span> = new Map();
  private activeSpans: Map<string, string> = new Map(); // contextId -> spanId
  private serviceName: string;

  constructor(serviceName: string = 'tlevor') {
    this.serviceName = serviceName;
  }

  startSpan(options: SpanOptions, contextId?: string): Span {
    const traceId = contextId || randomUUID().replace(/-/g, '');
    const spanId = randomUUID().replace(/-/g, '').slice(0, 16);

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: options.parentSpanId,
      name: options.name,
      kind: options.kind || 'internal',
      startTime: Date.now(),
      status: 'UNSET',
      attributes: {
        'service.name': this.serviceName,
        ...options.attributes,
      },
      events: [],
    };

    this.spans.set(spanId, span);
    if (contextId) this.activeSpans.set(contextId, spanId);
    return span;
  }

  endSpan(spanId: string, status: 'OK' | 'ERROR' = 'OK'): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
  }

  addEvent(spanId: string, name: string, attributes?: Record<string, any>): void {
    const span = this.spans.get(spanId);
    if (span) span.events.push({ name, timestamp: Date.now(), attributes });
  }

  setAttribute(spanId: string, key: string, value: string | number | boolean): void {
    const span = this.spans.get(spanId);
    if (span) span.attributes[key] = value;
  }

  getSpan(spanId: string): Span | undefined { return this.spans.get(spanId); }

  getActiveSpan(contextId: string): Span | undefined {
    const spanId = this.activeSpans.get(contextId);
    return spanId ? this.spans.get(spanId) : undefined;
  }

  getSpans(): Span[] { return Array.from(this.spans.values()); }

  getTrace(traceId: string): Span[] {
    return Array.from(this.spans.values()).filter(s => s.traceId === traceId);
  }

  formatJaeger(): any[] {
    return Array.from(this.spans.values()).map(span => ({
      traceID: span.traceId,
      spanID: span.spanId,
      parentSpanID: span.parentSpanId,
      operationName: span.name,
      startTime: span.startTime * 1000,
      duration: (span.duration || 0) * 1000,
      tags: {
        'span.kind': span.kind,
        'service.name': this.serviceName,
        ...span.attributes,
      },
      logs: span.events.map(e => ({
        timestamp: e.timestamp * 1000,
        fields: { message: e.name, ...e.attributes },
      })),
    }));
  }

  clear(): void { this.spans.clear(); this.activeSpans.clear(); }
}

// ==================== Middleware ====================

export function tracingMiddleware(tracer: Tracer): { requestMiddleware: any; responseMiddleware: any } {
  const requestMiddleware = async (ctx: any) => {
    const traceId = ctx.req.headers['x-trace-id'] || randomUUID().replace(/-/g, '');
    const parentSpanId = ctx.req.headers['x-span-id'];

    const span = tracer.startSpan({
      name: `${ctx.req.method} ${ctx.req.path}`,
      parentSpanId,
      kind: 'server',
      attributes: {
        'http.method': ctx.req.method,
        'http.url': ctx.req.url,
        'http.user_agent': ctx.req.headers['user-agent'] || '',
      },
    }, traceId);

    (ctx.state as any).traceId = traceId;
    (ctx.state as any).spanId = span.spanId;
    ctx.res.header('X-Trace-Id', traceId);
  };

  const responseMiddleware = async (ctx: any) => {
    const spanId = (ctx.state as any).spanId;
    if (spanId) {
      tracer.setAttribute(spanId, 'http.status_code', ctx.res.statusCode);
      tracer.endSpan(spanId, ctx.res.statusCode < 400 ? 'OK' : 'ERROR');
    }
  };

  return { requestMiddleware, responseMiddleware };
}

// ==================== Span Helper ====================

export function withSpan<T>(tracer: Tracer, name: string, fn: (span: Span) => Promise<T>, contextId?: string): Promise<T> {
  const span = tracer.startSpan({ name }, contextId);
  return fn(span)
    .then(result => { tracer.endSpan(span.spanId, 'OK'); return result; })
    .catch(error => { tracer.setAttribute(span.spanId, 'error', error.message); tracer.endSpan(span.spanId, 'ERROR'); throw error; });
}

// ==================== Factory ====================

export function createTracer(serviceName?: string): Tracer { return new Tracer(serviceName); }