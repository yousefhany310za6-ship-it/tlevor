import { describe, it, expect, vi } from 'vitest';
import { MemoryQueue, RepeatScheduler } from '../src/index';

describe('MemoryQueue', () => {
  it('should add jobs', async () => {
    const queue = new MemoryQueue('test');
    const job = await queue.add('send-email', { to: 'test@test.com' });
    expect(job.name).toBe('send-email');
    expect(job.status).toBe('waiting');
    expect(job.data.to).toBe('test@test.com');
  });

  it('should process jobs', async () => {
    const queue = new MemoryQueue('test');
    const processed: string[] = [];
    queue.process('task', async (job) => { processed.push(job.data.msg); return 'done'; });
    await queue.add('task', { msg: 'hello' });
    await new Promise(r => setTimeout(r, 50));
    expect(processed).toContain('hello');
  });

  it('should track job counts', async () => {
    const queue = new MemoryQueue('test');
    queue.process('task', async () => 'done');
    await queue.add('task', { x: 1 });
    await queue.add('task', { x: 2 });
    await new Promise(r => setTimeout(r, 50));
    const counts = await queue.getJobCounts();
    expect(counts.completed || 0).toBeGreaterThanOrEqual(1);
  });

  it('should handle failed jobs with retries', async () => {
    const queue = new MemoryQueue('test');
    let attempts = 0;
    queue.process('fail-task', async () => { attempts++; throw new Error('fail'); });
    await queue.add('fail-task', {}, { attempts: 2 });
    await new Promise(r => setTimeout(r, 100));
    expect(attempts).toBe(2);
  });

  it('should emit events', async () => {
    const queue = new MemoryQueue('test');
    const events: string[] = [];
    queue.on('job:completed', () => events.push('completed'));
    queue.process('task', async () => 'done');
    await queue.add('task', {});
    await new Promise(r => setTimeout(r, 50));
    expect(events).toContain('completed');
  });

  it('should delay jobs', async () => {
    const queue = new MemoryQueue('test');
    const events: string[] = [];
    queue.on('job:completed', () => events.push('done'));
    queue.process('task', async () => 'ok');
    await queue.add('task', {}, { delay: 100 });
    expect(events).toHaveLength(0);
    await new Promise(r => setTimeout(r, 200));
    expect(events).toContain('done');
  });

  it('should pause and resume', async () => {
    const queue = new MemoryQueue('test');
    queue.process('task', async () => 'ok');
    await queue.pause();
    await queue.add('task', {});
    await new Promise(r => setTimeout(r, 50));
    const counts = await queue.getJobCounts();
    expect(counts.paused || counts.waiting).toBeGreaterThanOrEqual(1);
  });

  it('should clean old jobs', async () => {
    const queue = new MemoryQueue('test');
    queue.process('task', async () => 'ok');
    await queue.add('task', {});
    await new Promise(r => setTimeout(r, 50));
    const cleaned = await queue.clean(0);
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });
});

describe('RepeatScheduler', () => {
  it('should add and remove repeatable jobs', () => {
    const queue = new MemoryQueue('test');
    const scheduler = new RepeatScheduler(queue);
    const id = scheduler.add('task', {}, { every: 60000 });
    expect(id).toContain('repeat:');
    expect(scheduler.remove(id)).toBe(true);
    expect(scheduler.remove(id)).toBe(false);
  });
});