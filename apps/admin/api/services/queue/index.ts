// Every business module imports `queue` from HERE, never a concrete
// implementation file directly — see postgresQueue.ts's header for why, and
// for the migration path to a different backing implementation later.
export { postgresQueue as queue } from './postgresQueue';
export type { Queue, EnqueueOptions, JobHandler, JobMeta } from './types';
