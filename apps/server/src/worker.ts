import { Worker } from 'bullmq';
import { redis } from './redis';
import { migrate } from './db';
import { log } from './log';
import { indexRepository } from './ingest/indexer';

async function main() {
  await migrate();
  const w = new Worker(
    'index',
    async (job) => indexRepository(job.data.jobId as string, job.data.repoId as string),
    { connection: redis, concurrency: 1 },
  );
  w.on('failed', (job, err) => log.error({ job: job?.id, err: err.message }, 'job failed'));
  log.info('worker ready');
}
main().catch((e) => { console.error(e); process.exit(1); });
