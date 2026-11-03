import { URL } from 'node:url';
import { QualityOption, ManifestAnalysisResult, VideoInfo } from './types';
import { resolveRelativeUrl } from './hlsAdapter';

export interface DashRepresentation {
  id: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  mimeType: string;
  initializationUrl?: string;
  mediaTemplateUrl?: string;
}

/**
 * Parses MPEG-DASH XML MPD string content into structured track representations.
 */
export function parseDashMpdContent(content: string, mpdUrl: string): ManifestAnalysisResult {
  const videoTracks: ManifestAnalysisResult['videoTracks'] = [];
  const audioTracks: ManifestAnalysisResult['audioTracks'] = [];

  // Match AdaptationSets
  const adaptationSetRegex = /<AdaptationSet([\s\S]*?)<\/AdaptationSet>/gi;
  let adaptMatch: RegExpExecArray | null;

  while ((adaptMatch = adaptationSetRegex.exec(content)) !== null) {
    const adaptBlock = adaptMatch[1];
    const mimeMatch = adaptBlock.match(/mimeType="([^"]+)"/i);
    const contentTypeMatch = adaptBlock.match(/contentType="([^"]+)"/i);

    const isVideo =
      (mimeMatch && mimeMatch[1].includes('video')) ||
      (contentTypeMatch && contentTypeMatch[1].includes('video'));
    const isAudio =
      (mimeMatch && mimeMatch[1].includes('audio')) ||
      (contentTypeMatch && contentTypeMatch[1].includes('audio'));

    // Extract representations
    const repRegex = /<Representation([\s\S]*?)(?:<\/Representation>|\/>)/gi;
    let repMatch: RegExpExecArray | null;

    while ((repMatch = repRegex.exec(adaptBlock)) !== null) {
      const repBlock = repMatch[1];
      const idMatch = repBlock.match(/id="([^"]+)"/i);
      const bwMatch = repBlock.match(/bandwidth="(\d+)"/i);
      const widthMatch = repBlock.match(/width="(\d+)"/i);
      const heightMatch = repBlock.match(/height="(\d+)"/i);
      const codecsMatch = repBlock.match(/codecs="([^"]+)"/i);

      const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 1000000;
      const height = heightMatch ? parseInt(heightMatch[1], 10) : 720;
      const width = widthMatch ? parseInt(widthMatch[1], 10) : Math.round((height * 16) / 9);
      const id = idMatch ? idMatch[1] : `rep-${videoTracks.length + audioTracks.length + 1}`;
      const codecs = codecsMatch ? codecsMatch[1] : isVideo ? 'avc1.4d401f' : 'mp4a.40.2';

      if (isVideo) {
        videoTracks.push({
          id,
          resolution: `${width}x${height}`,
          bandwidth,
          codecs,
          url: mpdUrl,
        });
      } else if (isAudio) {
        audioTracks.push({
          id,
          language: 'default',
          bandwidth,
          codecs,
          url: mpdUrl,
        });
      }
    }
  }

  // Sort video tracks descending by bandwidth
  videoTracks.sort((a, b) => b.bandwidth - a.bandwidth);

  return {
    isMaster: true,
    manifestType: 'dash',
    targetDuration: 4,
    videoTracks,
    audioTracks,
    isSeparateAudioVideo: audioTracks.length > 0,
  };
}

export async function getDashVideoInfo(url: string, fetchFn = fetch): Promise<VideoInfo> {
  const response = await fetchFn(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VideoDownloaderPro/2.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch MPEG-DASH manifest: HTTP ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  const analysis = parseDashMpdContent(content, url);

  const availableQualities: QualityOption[] = [];
  for (const track of analysis.videoTracks) {
    let resLabel: any = '720p';
    let height = 720;
    if (track.resolution.includes('x')) {
      height = parseInt(track.resolution.split('x')[1], 10);
      if (height >= 1080) resLabel = '1080p';
      else if (height >= 720) resLabel = '720p';
      else if (height >= 480) resLabel = '480p';
      else if (height >= 360) resLabel = '360p';
      else resLabel = '240p';
    }

    availableQualities.push({
      id: `dash-${resLabel}-${track.id}`,
      resolution: resLabel,
      label: `${resLabel} (${track.resolution})`,
      height,
      bitrate: track.bandwidth,
      format: 'mp4',
      videoCodec: track.codecs,
      manifestUrl: url,
    });
  }

  const availableAudioFormats: QualityOption[] = [
    {
      id: 'dash-audio-mp3',
      resolution: 'original',
      label: 'MP3 Audio (Converted)',
      height: 0,
      bitrate: 256000,
      format: 'mp3',
      audioCodec: 'mp3',
      isAudioOnly: true,
      manifestUrl: url,
    },
  ];

  return {
    id: `dash-${Buffer.from(url).toString('base64url').slice(0, 16)}`,
    url,
    title: 'MPEG-DASH Media Stream',
    description: `MPEG-DASH stream parsed with ${videoTracksSummary(analysis.videoTracks.length)} and ${analysis.audioTracks.length} audio adaptation set(s).`,
    thumbnail: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=640&q=80',
    durationSeconds: 0,
    durationFormatted: 'Segmented Stream',
    platform: 'MPEG-DASH',
    platformCategory: 'dash',
    availableQualities: availableQualities.length > 0 ? availableQualities : [
      {
        id: 'dash-default',
        resolution: 'best',
        label: 'Best Available Representation',
        height: 720,
        format: 'mp4',
      },
    ],
    availableAudioFormats,
    isAuthorized: true,
    permissionStatus: 'authorized',
    isStream: true,
    manifestType: 'dash',
  };
}

function videoTracksSummary(count: number): string {
  return `${count} video representation${count === 1 ? '' : 's'}`;
}
