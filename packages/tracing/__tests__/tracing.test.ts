import { describe, it, expect } from 'vitest';
import { Tracer, withSpan, createTracer } from '../src/index';

describe('Tracer', () => {
  it('should create tracer', () => {
    const tracer = createTracer('test-service');
    expect(tracer).toBeInstanceOf(Tracer);
  });

  it('should start and end spans', () => {
    const tracer = new Tracer('test');
    const span = tracer.startSpan({ name: 'test-span' });
    expect(span.name).toBe('test-span');
    expect(span.status).toBe('UNSET');
    tracer.endSpan(span.spanId, 'OK');
    expect(span.status).toBe('OK');
    expect(span.duration).toBeGreaterThanOrEqual(0);
  });

  it('should add events to spans', () => {
    const tracer = new Tracer('test');
    const span = tracer.startSpan({ name: 'test-span' });
    tracer.addEvent(span.spanId, 'db.query', { sql: 'SELECT * FROM users' });
    expect(span.events).toHaveLength(1);
    expect(span.events[0].name).toBe('db.query');
  });

  it('should set attributes', () => {
    const tracer = new Tracer('test');
    const span = tracer.startSpan({ name: 'test-span' });
    tracer.setAttribute(span.spanId, 'http.status_code', 200);
    expect(span.attributes['http.status_code']).toBe(200);
  });

  it('should get trace', () => {
    const tracer = new Tracer('test');
    const span = tracer.startSpan({ name: 'span1' });
    tracer.startSpan({ name: 'span2' }, span.traceId);
    const trace = tracer.getTrace(span.traceId);
    expect(trace).toHaveLength(2);
  });

  it('should format for Jaeger', () => {
    const tracer = new Tracer('test');
    const span = tracer.startSpan({ name: 'test-span', kind: 'server' });
    tracer.endSpan(span.spanId);
    const jaeger = tracer.formatJaeger();
    expect(jaeger).toHaveLength(1);
    expect(jaeger[0].operationName).toBe('test-span');
    expect(jaeger[0].tags['span.kind']).toBe('server');
  });

  it('should clear spans', () => {
    const tracer = new Tracer('test');
    tracer.startSpan({ name: 'test' });
    expect(tracer.getSpans()).toHaveLength(1);
    tracer.clear();
    expect(tracer.getSpans()).toHaveLength(0);
  });
});

describe('withSpan', () => {
  it('should execute function within a span', async () => {
    const tracer = new Tracer('test');
    const result = await withSpan(tracer, 'operation', async (span) => {
      expect(span.name).toBe('operation');
      return 42;
    });
    expect(result).toBe(42);
  });

  it('should handle errors', async () => {
    const tracer = new Tracer('test');
    await expect(withSpan(tracer, 'failing', async () => {
      throw new Error('test error');
    })).rejects.toThrow('test error');
  });
});