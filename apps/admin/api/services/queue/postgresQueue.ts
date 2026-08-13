import { eq, and, lte } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { logger } from '../../../logger';
import type { Queue, EnqueueOptions, JobHandler } from './types';

const BATCH_SIZE = 20;

class PostgresQueue implements Queue {
  private handlers = new Map<string, JobHandler>();
  private memoryQueue: Array<{ jobType: string; payload: any; tenantId?: number }> = [];

  async enqueue(jobType: string, payload: any, opts: EnqueueOptions = {}): Promise<void> {
    try {
      await db.insert(schema.backgroundJobs).values({
        tenantId: opts.tenantId ?? null,
        jobType,
        payload: payload ?? {},
        runAfter: opts.runAfter ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 3,
      });
    } catch (err: any) {
      logger.warn('queue: DB insert fallback to memory queue', { error: err?.message });
    }
    this.memoryQueue.push({ jobType, payload, tenantId: opts.tenantId });
  }

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  async pollOnce(): Promise<void> {
    if (this.handlers.size === 0) return;

    let due: any[] = [];
    try {
      due = await db.select().from(schema.backgroundJobs).where(
        eq(schema.backgroundJobs.status, 'pending')
      ).limit(BATCH_SIZE);
    } catch {
      due = [];
    }

    if (due.length === 0 && this.memoryQueue.length > 0) {
      const items = [...this.memoryQueue];
      this.memoryQueue = [];
      for (const item of items) {
        const handler = this.handlers.get(item.jobType);
        if (handler) {
          try {
            await handler(item.payload, { jobId: 1, tenantId: item.tenantId, attempts: 1 });
          } catch (err: any) {
            logger.error('queue: memory job failed', { jobType: item.jobType, error: err?.message });
          }
        }
      }
      return;
    }

    for (const job of due) {
      const handler = this.handlers.get(job.jobType);
      if (!handler) continue;

      try {
        await db.update(schema.backgroundJobs)
          .set({ status: 'running', attempts: job.attempts + 1 })
          .where(eq(schema.backgroundJobs.id, job.id));
      } catch {}

      try {
        await handler(job.payload, { jobId: job.id, tenantId: job.tenantId, attempts: job.attempts + 1 });
        await db.update(schema.backgroundJobs)
          .set({ status: 'done', completedAt: new Date() })
          .where(eq(schema.backgroundJobs.id, job.id)).catch(() => {});
      } catch (err: any) {
        const willRetry = job.attempts + 1 < job.maxAttempts;
        await db.update(schema.backgroundJobs)
          .set({
            status: willRetry ? 'pending' : 'failed',
            lastError: err?.message || String(err),
            runAfter: willRetry ? new Date(Date.now() + 60_000) : undefined,
          })
          .where(eq(schema.backgroundJobs.id, job.id)).catch(() => {});
        logger.error('queue: job failed', { jobId: job.id, jobType: job.jobType, attempts: job.attempts + 1, willRetry, error: err?.message });
      }
    }
  }
}

export const postgresQueue = new PostgresQueue();
