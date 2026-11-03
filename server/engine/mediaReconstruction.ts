import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export interface ReconstructionOptions {
  jobId: string;
  outputDir: string;
  outputFormat: 'mp4' | 'mp3';
  videoSegments?: string[];
  audioSegments?: string[];
  combinedSegments?: string[];
  title?: string;
}

export interface ReconstructionResult {
  success: boolean;
  finalFilePath: string;
  fileSizeBytes: number;
  durationSeconds?: number;
  format: string;
  error?: string;
}

/**
 * Executes an FFmpeg command safely using child_process.spawn.
 */
export function runFFmpeg(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const ffmpegProcess = spawn('ffmpeg', args);
    let stdout = '';
    let stderr = '';

    ffmpegProcess.stdout.on('data', (d) => (stdout += d.toString()));
    ffmpegProcess.stderr.on('data', (d) => (stderr += d.toString()));

    ffmpegProcess.on('error', (err) => {
      reject(err);
    });

    ffmpegProcess.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

/**
 * Reconstructs segments into a single validated MP4 video or MP3 audio file.
 */
export async function reconstructMedia(options: ReconstructionOptions): Promise<ReconstructionResult> {
  const { jobId, outputDir, outputFormat, videoSegments = [], audioSegments = [], combinedSegments = [], title = 'video' } = options;

  const jobDir = path.join(outputDir, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const sanitizedTitle = title.replace(/[^a-zA-Z0-9_\u0600-\u06FF\s-]/g, '').trim().slice(0, 80) || 'media';
  const finalFileName = `${sanitizedTitle}_${jobId.slice(0, 6)}.${outputFormat}`;
  const finalFilePath = path.join(outputDir, finalFileName);

  try {
    // Case 1: Separate Video and Audio tracks
    if (videoSegments.length > 0 && audioSegments.length > 0) {
      // 1. Create concat list for video
      const videoListPath = path.join(jobDir, 'video_concat.txt');
      const videoListContent = videoSegments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(videoListPath, videoListContent);

      // 2. Create concat list for audio
      const audioListPath = path.join(jobDir, 'audio_concat.txt');
      const audioListContent = audioSegments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(audioListPath, audioListContent);

      if (outputFormat === 'mp3') {
        // Audio only requested
        const ffmpegArgs = [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', audioListPath,
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '256k',
          finalFilePath,
        ];
        await runFFmpeg(ffmpegArgs);
      } else {
        // Merge separate video and audio into MP4
        const ffmpegArgs = [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', videoListPath,
          '-f', 'concat',
          '-safe', '0',
          '-i', audioListPath,
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          finalFilePath,
        ];
        await runFFmpeg(ffmpegArgs);
      }
    } else {
      // Case 2: Combined transport segments
      const segList = combinedSegments.length > 0 ? combinedSegments : videoSegments;
      if (segList.length === 0) {
        throw new Error('No segments provided for media reconstruction');
      }

      const listPath = path.join(jobDir, 'concat_list.txt');
      const listContent = segList.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(listPath, listContent);

      if (outputFormat === 'mp3') {
        const ffmpegArgs = [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', listPath,
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '256k',
          finalFilePath,
        ];
        await runFFmpeg(ffmpegArgs);
      } else {
        const ffmpegArgs = [
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-i', listPath,
          '-c', 'copy',
          '-movflags', '+faststart',
          finalFilePath,
        ];
        await runFFmpeg(ffmpegArgs);
      }
    }

    // Validate the generated final file
    if (!fs.existsSync(finalFilePath)) {
      throw new Error(`Output file was not generated at expected path: ${finalFilePath}`);
    }

    const stat = fs.statSync(finalFilePath);
    if (stat.size === 0) {
      throw new Error('Generated output file is empty (0 bytes).');
    }

    // Automatic cleanup of temporary raw segments to save disk space
    try {
      const segDir = path.join(jobDir, 'segments');
      if (fs.existsSync(segDir)) {
        fs.rmSync(segDir, { recursive: true, force: true });
      }
    } catch {
      // Non-blocking cleanup error
    }

    return {
      success: true,
      finalFilePath,
      fileSizeBytes: stat.size,
      format: outputFormat,
    };
  } catch (err: any) {
    return {
      success: false,
      finalFilePath: '',
      fileSizeBytes: 0,
      format: outputFormat,
      error: err.message || 'Media reconstruction failed during FFmpeg processing',
    };
  }
}
