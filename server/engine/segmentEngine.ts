import * as fs from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MediaSegment } from '../adapters/types';

export interface SegmentEngineProgress {
  totalSegments: number;
  completedSegments: number;
  failedSegments: number;
  retriedSegments: number;
  currentSegmentIndex: number;
  bytesDownloaded: number;
  speedBytesPerSec: number;
  percent: number;
  etaSeconds: number;
}

export interface SegmentEngineOptions {
  jobId: string;
  concurrency?: number;
  maxRetries?: number;
  timeoutMs?: number;
  outputDir: string;
  onProgress?: (progress: SegmentEngineProgress) => void;
}

/**
 * Downloads a collection of media segments into an on-disk directory using a bounded worker pool.
 * Memory efficient: writes chunks directly to disk using streams.
 */
export async function downloadSegmentsBatch(
  segments: MediaSegment[],
  options: SegmentEngineOptions
): Promise<{
  orderedFiles: string[];
  totalBytes: number;
  failedCount: number;
}> {
  const { jobId, outputDir, concurrency = 4, maxRetries = 3, onProgress } = options;

  // Ensure output directory exists
  const segmentsDir = path.join(outputDir, jobId, 'segments');
  fs.mkdirSync(segmentsDir, { recursive: true });

  let completedCount = 0;
  let failedCount = 0;
  let retriedCount = 0;
  let totalBytes = 0;
  const startTime = Date.now();
  let lastReportTime = startTime;

  const orderedFiles: string[] = new Array(segments.length);

  // Worker queue
  let nextQueueIndex = 0;

  async function downloadSingleSegment(seg: MediaSegment): Promise<void> {
    const ext = seg.isInitSegment ? '.init' : seg.type === 'audio' ? '.aac' : '.ts';
    const filePath = path.join(segmentsDir, `seg_${String(seg.index).padStart(6, '0')}${ext}`);
    orderedFiles[seg.index] = filePath;

    // Check if segment is already downloaded and valid
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) {
        completedCount++;
        totalBytes += stat.size;
        return;
      }
    }

    let attempts = 0;
    let success = false;

    while (attempts <= maxRetries && !success) {
      attempts++;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);

        const response = await fetch(seg.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VideoDownloaderPro/2.0',
            ...(seg.byteRange ? { Range: `bytes=${seg.byteRange}` } : {}),
          },
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status} for segment ${seg.index}`);
        }

        if (!response.body) {
          throw new Error(`Empty response body for segment ${seg.index}`);
        }

        // Stream directly to file on disk to prevent RAM exhaustion
        const fileStream = fs.createWriteStream(filePath, { flags: 'w' });
        await pipeline(response.body as any, fileStream);

        const stat = fs.statSync(filePath);
        if (stat.size === 0) {
          throw new Error('Downloaded segment is empty');
        }

        totalBytes += stat.size;
        seg.bytes = stat.size;
        seg.status = 'completed';
        success = true;
        completedCount++;
      } catch (err) {
        if (attempts <= maxRetries) {
          retriedCount++;
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, attempts * 500));
        } else {
          failedCount++;
          seg.status = 'failed';
          break;
        }
      }
    }

    // Progress throttle (every 200ms or last)
    const now = Date.now();
    if (onProgress && (now - lastReportTime > 200 || completedCount + failedCount >= segments.length)) {
      lastReportTime = now;
      const elapsedSec = (now - startTime) / 1000;
      const speed = elapsedSec > 0 ? totalBytes / elapsedSec : 0;
      const percent = Math.min(100, Math.round(((completedCount) / Math.max(1, segments.length)) * 100));
      const remainingSegments = segments.length - completedCount;
      const etaSeconds = speed > 0 ? Math.round((remainingSegments * (totalBytes / Math.max(1, completedCount))) / speed) : 0;

      onProgress({
        totalSegments: segments.length,
        completedSegments: completedCount,
        failedSegments: failedCount,
        retriedSegments: retriedCount,
        currentSegmentIndex: seg.index,
        bytesDownloaded: totalBytes,
        speedBytesPerSec: Math.round(speed),
        percent,
        etaSeconds,
      });
    }
  }

  // Run concurrency workers
  const workerPromises: Promise<void>[] = [];
  const poolSize = Math.min(concurrency, segments.length);

  for (let w = 0; w < poolSize; w++) {
    const worker = (async () => {
      while (nextQueueIndex < segments.length) {
        const itemIndex = nextQueueIndex++;
        const segment = segments[itemIndex];
        await downloadSingleSegment(segment);
      }
    })();
    workerPromises.push(worker);
  }

  await Promise.all(workerPromises);

  return {
    orderedFiles: orderedFiles.filter(Boolean),
    totalBytes,
    failedCount,
  };
}
