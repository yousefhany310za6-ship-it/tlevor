import { describe, it, expect } from 'vitest';
import { Counter, Gauge, Histogram, MetricsRegistry, createMetricsRegistry } from '../src/index';

describe('Counter', () => {
  it('should increment', () => {
    const counter = new Counter({ name: 'test_counter', help: 'Test' });
    counter.inc();
    expect(counter.getValue()).toBe(1);
    counter.inc(5);
    expect(counter.getValue()).toBe(6);
  });

  it('should handle labels', () => {
    const counter = new Counter({ name: 'test', help: 'Test', labels: ['method'] });
    counter.inc(1, { method: 'GET' });
    counter.inc(2, { method: 'POST' });
    expect(counter.getValue({ method: 'GET' })).toBe(1);
    expect(counter.getValue({ method: 'POST' })).toBe(2);
  });

  it('should reset', () => {
    const counter = new Counter({ name: 'test', help: 'Test' });
    counter.inc(5);
    counter.reset();
    expect(counter.getValue()).toBe(0);
  });
});

describe('Gauge', () => {
  it('should set and get', () => {
    const gauge = new Gauge({ name: 'test_gauge', help: 'Test' });
    gauge.set(42);
    expect(gauge.getValue()).toBe(42);
  });

  it('should inc and dec', () => {
    const gauge = new Gauge({ name: 'test', help: 'Test' });
    gauge.inc();
    expect(gauge.getValue()).toBe(1);
    gauge.dec();
    expect(gauge.getValue()).toBe(0);
  });
});

describe('Histogram', () => {
  it('should observe values', () => {
    const histogram = new Histogram({ name: 'test_hist', help: 'Test', buckets: [1, 5, 10] });
    histogram.observe(0.5);
    histogram.observe(3);
    histogram.observe(8);
    const { buckets, count, sum } = histogram.getValue();
    expect(count).toBe(3);
    expect(sum).toBe(11.5);
    expect(buckets.get(1)).toBe(1);
    expect(buckets.get(5)).toBe(2);
    expect(buckets.get(10)).toBe(3);
  });
});

describe('MetricsRegistry', () => {
  it('should create metrics', () => {
    const registry = createMetricsRegistry();
    const counter = registry.counter({ name: 'requests', help: 'Total requests' });
    const gauge = registry.gauge({ name: 'connections', help: 'Active connections' });
    const histogram = registry.histogram({ name: 'latency', help: 'Request latency' });
    counter.inc();
    gauge.set(5);
    histogram.observe(0.1);
    expect(counter.getValue()).toBe(1);
    expect(gauge.getValue()).toBe(5);
    expect(histogram.getValue().count).toBe(1);
  });

  it('should format as Prometheus', () => {
    const registry = createMetricsRegistry();
    registry.counter({ name: 'http_requests_total', help: 'Total' }).inc(10);
    registry.gauge({ name: 'active_connections', help: 'Active' }).set(5);
    const output = registry.formatPrometheus();
    expect(output).toContain('http_requests_total 10');
    expect(output).toContain('active_connections 5');
    expect(output).toContain('# TYPE http_requests_total counter');
  });
});