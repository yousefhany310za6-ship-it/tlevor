import { describe, it, expect } from 'vitest';
import { Scheduler, parseCron, getNextCronDate, cronMatches } from '../src/index';

describe('Cron Parser', () => {
  it('should parse cron expressions', () => {
    const expr = parseCron('*/5 * * * *');
    expect(expr.minute).toBe('*/5');
    expect(expr.hour).toBe('*');
  });

  it('should throw on invalid expression', () => {
    expect(() => parseCron('* *')).toThrow();
  });

  it('should match wildcard', () => {
    const expr = parseCron('* * * * *');
    expect(cronMatches(expr, new Date(2024, 0, 1, 12, 30))).toBe(true);
  });

  it('should match specific values', () => {
    const expr = parseCron('0 12 * * *');
    expect(cronMatches(expr, new Date(2024, 0, 1, 12, 0))).toBe(true);
    expect(cronMatches(expr, new Date(2024, 0, 1, 13, 0))).toBe(false);
  });

  it('should match ranges', () => {
    const expr = parseCron('0 9-17 * * *');
    expect(cronMatches(expr, new Date(2024, 0, 1, 12, 0))).toBe(true);
    expect(cronMatches(expr, new Date(2024, 0, 1, 8, 0))).toBe(false);
  });

  it('should match steps', () => {
    const expr = parseCron('*/15 * * * *');
    expect(cronMatches(expr, new Date(2024, 0, 1, 0, 0))).toBe(true);
    expect(cronMatches(expr, new Date(2024, 0, 1, 0, 15))).toBe(true);
    expect(cronMatches(expr, new Date(2024, 0, 1, 0, 7))).toBe(false);
  });

  it('should get next cron date', () => {
    const from = new Date(2024, 0, 1, 0, 0);
    const next = getNextCronDate('0 12 * * *', from);
    expect(next.getHours()).toBe(12);
    expect(next.getMinutes()).toBe(0);
  });
});

describe('Scheduler', () => {
  it('should schedule a task', () => {
    const scheduler = new Scheduler();
    const id = scheduler.schedule('test', '* * * * *', () => {});
    expect(id).toContain('task:');
    expect(scheduler.getTask(id)).toBeDefined();
  });

  it('should add interval task', () => {
    const scheduler = new Scheduler();
    const id = scheduler.interval('test', 1000, () => {});
    expect(scheduler.getTask(id)).toBeDefined();
    scheduler.close();
  });

  it('should add timeout task', () => {
    const scheduler = new Scheduler();
    const id = scheduler.timeout('test', 1000, () => {});
    expect(scheduler.getTask(id)).toBeDefined();
    scheduler.close();
  });

  it('should pause and resume', () => {
    const scheduler = new Scheduler();
    const id = scheduler.interval('test', 1000, () => {});
    expect(scheduler.pause(id)).toBe(true);
    expect(scheduler.getTask(id)!.enabled).toBe(false);
    expect(scheduler.resume(id)).toBe(true);
    expect(scheduler.getTask(id)!.enabled).toBe(true);
    scheduler.close();
  });

  it('should remove task', () => {
    const scheduler = new Scheduler();
    const id = scheduler.interval('test', 1000, () => {});
    expect(scheduler.remove(id)).toBe(true);
    expect(scheduler.getTask(id)).toBeUndefined();
    scheduler.close();
  });

  it('should get all tasks', () => {
    const scheduler = new Scheduler();
    scheduler.interval('a', 1000, () => {});
    scheduler.interval('b', 2000, () => {});
    expect(scheduler.getTasks()).toHaveLength(2);
    scheduler.close();
  });
});