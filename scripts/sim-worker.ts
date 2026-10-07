// One worker thread, one seed: stream every sample to the parent as it is produced so the CLI
// can show live progress and keep the series, then report the run's outcome. All the work is
// `runSeed`; no other file duplicates the run loop.
import { parentPort, workerData } from 'node:worker_threads';
import { runSeed, type RunOptions } from '../src/lib/simrun.ts';

const port = parentPort;
if (port === null) throw new Error('sim-worker.ts must run as a worker thread');

const result = runSeed({
  ...(workerData as RunOptions),
  onSample: (sample) => port.postMessage({ type: 'sample', sample }),
});

port.postMessage({
  type: 'done',
  seed: result.seed,
  ticks: result.ticks,
  truncatedAt: result.truncatedAt,
  failedExpr: result.failedExpr,
});
