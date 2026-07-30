// Postgres-backed implementation of the Queue interface (types.ts), backed
// by the `background_jobs` table. Chosen over a Redis-backed queue
// (BullMQ) for now because this deployment doesn't provision Redis in
// production (REDIS_URL is unset in render.yaml — ioredis is only used
// today by the optional rate-limiter, apps/admin/api/middleware/
// rateLimit.ts, which degrades to in-memory when Redis isn't configured).
// Introducing a second infra dependency isn't justified at this scale.
//
// MIGRATION PATH TO BULLMQ/REDIS, if/when the workload justifies it
// (thousands of emails/hour, bulk payroll for tens of thousands of
// employees, high-concurrency notification delivery, multiple worker
// instances needing real horizontal scaling):
//   1. Provision Redis in production (a Render add-on, or an external
//      host like Upstash) and set REDIS_URL.
//   2. Write a `bullmqQueue.ts` implementing the same `Queue` interface
//      (types.ts) — enqueue() calls queue.add(), registerHandler() wires a
//      BullMQ Worker, pollOnce() becomes a no-op (BullMQ workers pull
//      continuously on their own, no external poll needed).
//   3. Swap the export in queue/index.ts from `postgresQueue` to the new
//      implementation. No business-module call site changes — every
//      consumer only ever imported `queue` from queue/index.ts, never this
//      file directly.
//   4. `background_jobs` can stay as a historical/audit table or be
//      retired; nothing else depends on its schema once the swap is made.

import { eq, and, lte } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { logger } from '../../../logger';
import type { Queue, EnqueueOptions, JobHandler } from './types';

const BATCH_SIZE = 20;

class PostgresQueue implements Queue {
  private handlers = new Map<string, JobHandler>();

  async enqueue(jobType: string, payload: any, opts: EnqueueOptions = {}): Promise<void> {
    await db.insert(schema.backgroundJobs).values({
      tenantId: opts.tenantId ?? null,
      jobType,
      payload: payload ?? {},
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
      and(
        eq(schema.backgroundJobs.status, 'pending'),
        lte(schema.backgroundJobs.runAfter, new Date()),
      )
    ).limit(BATCH_SIZE);

    for (const job of due) {
      const handler = this.handlers.get(job.jobType);
      if (!handler) continue; // no handler registered on this instance for this job type — leave pending, another deploy/instance may pick it up

      // Claim the job (pending -> running) before executing, so a slow
      // handler doesn't get picked up again by the next pollOnce() tick.
      const claimed = await db.update(schema.backgroundJobs)
        .set({ status: 'running', attempts: job.attempts + 1 })
        .where(and(eq(schema.backgroundJobs.id, job.id), eq(schema.backgroundJobs.status, 'pending')))
        .returning();
      if (claimed.length === 0) continue; // another tick/instance already claimed it

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
            // Simple linear backoff — good enough at this queue's current
            // volume; the BullMQ migration path above gets real
            // exponential backoff for free if this ever needs it.
            runAfter: willRetry ? new Date(Date.now() + 60_000) : undefined,
          })
          .where(eq(schema.backgroundJobs.id, job.id));
        logger.error('queue: job failed', { jobId: job.id, jobType: job.jobType, attempts: job.attempts + 1, willRetry, error: err?.message });
      }
    }
  }
}

export const postgresQueue = new PostgresQueue();
