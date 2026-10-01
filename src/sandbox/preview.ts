import { readFileSync } from 'node:fs';
import type { ActionId } from '../scenario/blueprint.js';
import { projectFork, type ForkJob } from './project.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: preview.js <fork.json>');
  process.exit(2);
}
const job = JSON.parse(readFileSync(file, 'utf8')) as ForkJob;
if (!job?.actionId || !job.fill || !job.play) {
  console.error('fork.json must contain actionId, fill, and play');
  process.exit(2);
}
process.stdout.write(JSON.stringify(projectFork(job.fill, job.play, job.actionId as ActionId)));
