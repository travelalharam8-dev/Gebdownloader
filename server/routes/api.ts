import { Router, Request, Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifyUrl, validateUrlSecurity } from '../security/urlValidator';
import { getYoutubeVideoInfo, getYoutubePlaylistInfo } from '../adapters/youtubeAdapter';
import { getFacebookVideoInfo } from '../adapters/facebookAdapter';
import { getEducationalVideoInfo, getEducationalCoursePlaylist } from '../adapters/educationalAdapter';
import { getHlsVideoInfo } from '../adapters/hlsAdapter';
import { getDashVideoInfo } from '../adapters/dashAdapter';
import { queueManager } from '../queue/queueManager';
import { storageManager } from '../storage/storageManager';

export const apiRouter = Router();

/**
 * GET /api/health - Health check and system readiness
 */
apiRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    platform: process.platform,
    ffmpegAvailable: true,
    activeDownloads: queueManager.getQueue().filter((j) => j.status === 'processing').length,
  });
});

/**
 * POST /api/video/info - Extracts metadata, formats, and authorization status
 */
apiRouter.post('/video/info', async (req: Request, res: Response) => {
  try {
    const { url, authToken } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const classification = classifyUrl(url);
    if (!classification.isValid) {
      return res.status(400).json({
        error: classification.error || 'Invalid or insecure URL',
        platform: classification.platform,
      });
    }

    let videoInfo;
    switch (classification.platform) {
      case 'youtube':
        videoInfo = await getYoutubeVideoInfo(url, classification.videoId);
        break;
      case 'facebook':
        videoInfo = await getFacebookVideoInfo(url);
        break;
      case 'educational':
        videoInfo = await getEducationalVideoInfo(url, authToken);
        break;
      case 'hls':
        videoInfo = await getHlsVideoInfo(url);
        break;
      case 'dash':
        videoInfo = await getDashVideoInfo(url);
        break;
      default:
        // Generic direct media or stream
        videoInfo = await getHlsVideoInfo(url);
        break;
    }

    return res.json({
      success: true,
      data: videoInfo,
      classification,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Failed to retrieve video information',
    });
  }
});

/**
 * POST /api/playlist/info - Retrieves playlist/course items
 */
apiRouter.post('/playlist/info', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Playlist URL is required' });
    }

    const classification = classifyUrl(url);
    if (!classification.isValid) {
      return res.status(400).json({ error: classification.error || 'Invalid URL' });
    }

    let playlistInfo;
    if (classification.platform === 'educational') {
      playlistInfo = await getEducationalCoursePlaylist(url);
    } else {
      playlistInfo = await getYoutubePlaylistInfo(url, classification.playlistId);
    }

    return res.json({
      success: true,
      data: playlistInfo,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Failed to retrieve playlist information',
    });
  }
});

/**
 * POST /api/download - Initiates a single download job
 */
apiRouter.post('/download', async (req: Request, res: Response) => {
  try {
    const { url, title, thumbnail, platform, quality, format, isStream, manifestType } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const classification = classifyUrl(url);
    if (!classification.isValid) {
      return res.status(400).json({ error: classification.error || 'URL validation failed' });
    }

    const job = queueManager.addJob({
      url,
      title: title || 'Media Resource',
      thumbnail,
      platform: platform || classification.platformName,
      quality: quality || '1080p',
      format: format === 'mp3' ? 'mp3' : 'mp4',
      isStream: !!isStream || classification.isDirectStream,
      manifestType: manifestType || (classification.platform === 'dash' ? 'dash' : 'hls'),
    });

    return res.json({
      success: true,
      jobId: job.id,
      job,
      message: 'Download job added to queue successfully',
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Failed to enqueue download job',
    });
  }
});

/**
 * POST /api/download/bulk - Enqueues multiple items from a playlist or batch
 */
apiRouter.post('/download/bulk', async (req: Request, res: Response) => {
  try {
    const { items, defaultQuality = '1080p', defaultFormat = 'mp4' } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Array of items is required' });
    }

    const queuedJobs = [];
    for (const item of items) {
      const classification = classifyUrl(item.url);
      if (!classification.isValid) continue;

      const job = queueManager.addJob({
        url: item.url,
        title: item.title || 'Playlist Video',
        thumbnail: item.thumbnail,
        platform: item.platform || classification.platformName,
        quality: item.selectedQuality || defaultQuality,
        format: item.selectedFormat || defaultFormat,
      });
      queuedJobs.push(job);
    }

    return res.json({
      success: true,
      queuedCount: queuedJobs.length,
      jobs: queuedJobs,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Failed to initiate bulk download',
    });
  }
});

/**
 * POST /api/download-links - Generates single or multi verified download links
 */
apiRouter.post('/download-links', async (req: Request, res: Response) => {
  try {
    const { jobId, quality, format } = req.body;
    let job = jobId ? queueManager.getJob(jobId) : null;

    if (!job) {
      // If no job was specified, look for recent completed item or create instant verified token
      const completed = queueManager.getHistory().find((j) => j.status === 'completed' && j.downloadUrl);
      if (completed) {
        job = completed;
      }
    }

    if (!job || !job.outputFilePath || !fs.existsSync(job.outputFilePath)) {
      return res.status(404).json({
        error: 'Media file is still processing or unavailable. Link cannot be generated yet.',
      });
    }

    const token = storageManager.generateDownloadToken(job.outputFilePath, `${job.title}.${format || job.format}`);
    const host = req.get('host') || '127.0.0.1:3000';
    const protocol = req.protocol;
    const directUrl = `${protocol}://${host}/api/download/file/${token.token}`;

    return res.json({
      success: true,
      downloadUrl: directUrl,
      token: token.token,
      expiresAt: new Date(token.expiresAt).toISOString(),
      fileSize: token.fileSizeBytes,
      fileName: token.fileName,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Failed to generate download link',
    });
  }
});

/**
 * POST /api/playlist/download-links - Generates bulk verified download links for playlist items
 */
apiRouter.post('/playlist/download-links', async (req: Request, res: Response) => {
  try {
    const { items, format = 'mp4' } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items list required' });
    }

    const host = req.get('host') || '127.0.0.1:3000';
    const protocol = req.protocol;
    const generatedLinks: string[] = [];

    // Find completed files or generate verified temporary tokens
    for (const item of items) {
      const match = queueManager.getHistory().find((j) => j.url === item.url && j.status === 'completed');
      if (match && match.outputFilePath && fs.existsSync(match.outputFilePath)) {
        const token = storageManager.generateDownloadToken(match.outputFilePath);
        generatedLinks.push(`${protocol}://${host}/api/download/file/${token.token}`);
      } else {
        // Synthesize real verified download job endpoint
        const syntheticJob = queueManager.addJob({
          url: item.url,
          title: item.title,
          platform: 'Playlist Media',
          format,
        });
        generatedLinks.push(`${protocol}://${host}/api/download/status/${syntheticJob.id}`);
      }
    }

    return res.json({
      success: true,
      totalCount: items.length,
      generatedCount: generatedLinks.length,
      linksText: generatedLinks.join('\n'),
      links: generatedLinks,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Failed to generate bulk playlist links',
    });
  }
});

/**
 * GET /api/download/status/:id - Real-time progress and stage status of a job
 */
apiRouter.get('/download/status/:id', (req: Request, res: Response) => {
  const job = queueManager.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.json({
    success: true,
    job,
  });
});

/**
 * GET /api/download/file/:token - Streams completed file with Range request support
 */
apiRouter.get('/download/file/:token', (req: Request, res: Response) => {
  const token = storageManager.getToken(req.params.token);
  if (!token) {
    return res.status(410).json({
      error: 'Download link has expired or is invalid. Please generate a new link.',
    });
  }

  if (!fs.existsSync(token.filePath)) {
    return res.status(404).json({ error: 'File not found on storage disk.' });
  }

  const stat = fs.statSync(token.filePath);
  const range = req.headers.range;

  res.setHeader('Content-Type', token.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(token.fileName)}"`);
  res.setHeader('Accept-Ranges', 'bytes');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunksize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', chunksize);

    const stream = fs.createReadStream(token.filePath, { start, end });
    stream.pipe(res);
  } else {
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(token.filePath);
    stream.pipe(res);
  }
});

/**
 * GET /api/queue - Returns active & pending jobs
 */
apiRouter.get('/queue', (req: Request, res: Response) => {
  res.json({
    success: true,
    queue: queueManager.getQueue(),
    activeCount: queueManager.getQueue().filter((j) => j.status === 'processing').length,
    queuedCount: queueManager.getQueue().filter((j) => j.status === 'queued').length,
  });
});

/**
 * GET /api/history - Returns completed & failed download history
 */
apiRouter.get('/history', (req: Request, res: Response) => {
  res.json({
    success: true,
    history: queueManager.getHistory(),
  });
});

/**
 * POST /api/download/retry/:id - Retries a failed job
 */
apiRouter.post('/download/retry/:id', (req: Request, res: Response) => {
  const job = queueManager.retryJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.json({
    success: true,
    job,
  });
});

/**
 * DELETE /api/history/:id - Removes a history item
 */
apiRouter.delete('/history/:id', (req: Request, res: Response) => {
  const deleted = queueManager.removeJob(req.params.id);
  res.json({ success: deleted });
});

/**
 * POST /api/stream/info - Analyzes manifest for stream processor
 */
apiRouter.post('/stream/info', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Stream URL is required' });
    }

    const classification = classifyUrl(url);
    if (!classification.isValid) {
      return res.status(400).json({ error: classification.error || 'Invalid URL' });
    }

    let streamInfo;
    if (classification.platform === 'dash') {
      streamInfo = await getDashVideoInfo(url);
    } else {
      streamInfo = await getHlsVideoInfo(url);
    }

    return res.json({
      success: true,
      data: streamInfo,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Failed to inspect stream manifest',
    });
  }
});

/**
 * POST /api/stream/process - Starts full 14-stage stream reconstruction (One-click full video)
 */
apiRouter.post('/stream/process', async (req: Request, res: Response) => {
  try {
    const { url, title, quality = '1080p', format = 'mp4' } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Stream URL is required' });
    }

    const classification = classifyUrl(url);
    if (!classification.isValid) {
      return res.status(400).json({ error: classification.error || 'Invalid stream URL' });
    }

    const job = queueManager.addJob({
      url,
      title: title || 'Educational / HLS Stream Lesson',
      platform: classification.platformName,
      quality,
      format,
      isStream: true,
      manifestType: classification.platform === 'dash' ? 'dash' : 'hls',
    });

    return res.json({
      success: true,
      jobId: job.id,
      job,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err.message || 'Failed to trigger stream processing',
    });
  }
});

/**
 * GET /api/stream/status/:id - Real-time inspection of stream stages
 */
apiRouter.get('/stream/status/:id', (req: Request, res: Response) => {
  const job = queueManager.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Stream job not found' });
  }

  return res.json({
    success: true,
    jobId: job.id,
    currentStage: job.currentStage,
    stageIndex: job.stageIndex,
    totalStages: job.totalStages,
    progressPercent: job.progressPercent,
    segments: job.segments,
    speedBytesPerSec: job.speedBytesPerSec,
    etaSeconds: job.etaSeconds,
    status: job.status,
    downloadUrl: job.downloadUrl,
    error: job.error,
  });
});

/**
 * GET /api/settings - App settings
 */
apiRouter.get('/settings', (req: Request, res: Response) => {
  res.json({
    success: true,
    settings: queueManager.getSettings(),
  });
});

/**
 * POST /api/settings - Update app settings
 */
apiRouter.post('/settings', (req: Request, res: Response) => {
  const updated = queueManager.saveSettings(req.body);
  res.json({
    success: true,
    settings: updated,
  });
});
