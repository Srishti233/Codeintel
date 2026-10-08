import { Queue } from 'bullmq';
import { redis } from './redis';

export const indexQueue = new Queue('index', {
  connection: redis,
  defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
});
