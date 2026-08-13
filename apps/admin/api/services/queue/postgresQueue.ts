import { eq, and } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { logger } from '../../../logger';
import type { Queue, EnqueueOptions, JobHandler } from './types';

const BATCH_SIZE = 20;

class PostgresQueue implements Queue {
  private handlers = new Map<string, JobHandler>();

  async enqueue(jobType: string, payload: any, opts: EnqueueOptions = {}): Promise<void> {
    // Authoritative, fail-closed durable queue insertion into background_jobs table.
    // If the database is unreachable or insertion fails, enqueue() throws an exception
    // so the caller is aware that job persistence failed. No non-durable in-memory fallback.
    await db.insert(schema.backgroundJobs).values({
      tenantId: opts.tenantId ?? null,
      jobType,
      payload: payload ?? {},
      status: 'pending',
      attempts: 0,
      runAfter: opts.runAfter ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
    });
  }

  registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  async pollOnce(): Promise<void> {
    if (this.handlers.size === 0) return;

    const due = await db.select().from(schema.backgroundJobs).where(
      eq(schema.backgroundJobs.status, 'pending')
    ).limit(BATCH_SIZE);

    for (const job of due) {
      const handler = this.handlers.get(job.jobType);
      if (!handler) continue; // No handler registered on this instance for this jobType

      // Claim job (pending -> running) before execution
      const claimed = await db.update(schema.backgroundJobs)
        .set({ status: 'running', attempts: job.attempts + 1 })
        .where(and(eq(schema.backgroundJobs.id, job.id), eq(schema.backgroundJobs.status, 'pending')))
        .returning();

      if (claimed.length === 0) continue; // Already claimed by another worker instance

      try {
        await handler(job.payload, { jobId: job.id, tenantId: job.tenantId, attempts: job.attempts + 1 });
        await db.update(schema.backgroundJobs)
          .set({ status: 'done', completedAt: new Date() })
          .where(eq(schema.backgroundJobs.id, job.id));
      } catch (err: any) {
        const willRetry = job.attempts + 1 < job.maxAttempts;
        await db.update(schema.backgroundJobs)
          .set({
            status: willRetry ? 'pending' : 'failed',
            lastError: err?.message || String(err),
            runAfter: willRetry ? new Date(Date.now() + 60_000) : undefined,
          })
          .where(eq(schema.backgroundJobs.id, job.id));
        logger.error('queue: job failed', { jobId: job.id, jobType: job.jobType, attempts: job.attempts + 1, willRetry, error: err?.message });
      }
    }
  }
}

export const postgresQueue = new PostgresQueue();
