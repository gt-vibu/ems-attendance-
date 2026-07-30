// Business code (email sending, payroll recalculation, notification
// delivery, attendance reconciliation, report generation, ...) enqueues
// through THIS interface only, never against a concrete implementation
// directly. That's what makes swapping the backing implementation (Postgres
// today, possibly BullMQ/Redis later, if/when the workload actually
// justifies it — see postgresQueue.ts's file header for the migration
// path) an adapter change, not a rewrite of every module that uses it.

export interface EnqueueOptions {
  tenantId?: number | null;
  runAfter?: Date;
  maxAttempts?: number;
}

export interface JobMeta {
  jobId: number;
  tenantId: number | null;
  attempts: number;
}

export type JobHandler<T = any> = (payload: T, meta: JobMeta) => Promise<void>;

export interface Queue {
  enqueue(jobType: string, payload: any, opts?: EnqueueOptions): Promise<void>;
  registerHandler(jobType: string, handler: JobHandler): void;
  // Processes whatever's currently due — called on a timer by the leader
  // instance (see bootstrap/scheduler.ts). Not a long-running loop itself;
  // the caller controls cadence, so different implementations (a DB poll vs.
  // a Redis blocking pop) can pick whatever cadence suits them.
  pollOnce(): Promise<void>;
}
