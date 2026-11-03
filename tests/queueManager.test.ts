import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueManager } from '../server/queue/queueManager';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('Queue Manager: enqueues job and retrieves by ID', () => {
  const testRoot = path.join(process.cwd(), 'temp_test_queue');
  fs.mkdirSync(testRoot, { recursive: true });

  const qm = new QueueManager(testRoot);
  const job = qm.addJob({
    url: 'https://cdn.test.com/video.mp4',
    title: 'Test Unit Video',
    platform: 'Direct Media',
    quality: '1080p',
    format: 'mp4',
  });

  assert.ok(job.id);
  assert.equal(job.status, 'queued');
  assert.equal(job.title, 'Test Unit Video');

  const retrieved = qm.getJob(job.id);
  assert.ok(retrieved);
  assert.equal(retrieved?.id, job.id);

  // Settings
  const settings = qm.saveSettings({ maxConcurrentDownloads: 4 });
  assert.equal(settings.maxConcurrentDownloads, 4);

  // Cleanup test folder
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // Ignore cleanup error
  }
});
