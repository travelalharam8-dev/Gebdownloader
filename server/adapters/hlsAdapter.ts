import { URL } from 'node:url';
import { QualityOption, ManifestAnalysisResult, MediaSegment, VideoInfo } from './types';

/**
 * Resolves a potentially relative segment or manifest URL against a base URL.
 */
export function resolveRelativeUrl(baseUrl: string, targetUrl: string): string {
  try {
    return new URL(targetUrl, baseUrl).toString();
  } catch {
    return targetUrl;
  }
}

/**
 * Parses an M3U8 manifest content string into structured manifest analysis.
 */
export function parseM3U8Content(content: string, manifestUrl: string): ManifestAnalysisResult {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  const videoTracks: ManifestAnalysisResult['videoTracks'] = [];
  const audioTracks: ManifestAnalysisResult['audioTracks'] = [];
  let targetDuration = 0;

  if (isMaster) {
    // Master playlist with multiple variants
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Separate audio tracks
      if (line.startsWith('#EXT-X-MEDIA:') && line.includes('TYPE=AUDIO')) {
        const nameMatch = line.match(/NAME="([^"]+)"/);
        const langMatch = line.match(/LANGUAGE="([^"]+)"/);
        const uriMatch = line.match(/URI="([^"]+)"/);
        const groupMatch = line.match(/GROUP-ID="([^"]+)"/);

        if (uriMatch) {
          const resolvedAudioUrl = resolveRelativeUrl(manifestUrl, uriMatch[1]);
          audioTracks.push({
            id: groupMatch ? groupMatch[1] : `audio-${audioTracks.length + 1}`,
            language: langMatch ? langMatch[1] : (nameMatch ? nameMatch[1] : 'default'),
            bandwidth: 128000,
            codecs: 'mp4a.40.2',
            url: resolvedAudioUrl,
          });
        }
      }

      // Video stream variants
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        const codecsMatch = line.match(/CODECS="([^"]+)"/);

        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 1000000;
        const resolution = resolutionMatch ? resolutionMatch[1] : 'adaptive';
        const codecs = codecsMatch ? codecsMatch[1] : 'avc1.4d401f';

        // Next line contains the variant URI
        let nextIndex = i + 1;
        while (nextIndex < lines.length && lines[nextIndex].startsWith('#')) {
          nextIndex++;
        }

        if (nextIndex < lines.length) {
          const variantUri = lines[nextIndex];
          const resolvedVariantUrl = resolveRelativeUrl(manifestUrl, variantUri);
          videoTracks.push({
            id: `track-${videoTracks.length + 1}`,
            resolution,
            bandwidth,
            codecs,
            url: resolvedVariantUrl,
          });
        }
      }
    }
  } else {
    // Single media playlist
    let durationSum = 0;
    let segCount = 0;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseFloat(line.split(':')[1]) || 6;
      } else if (line.startsWith('#EXTINF:')) {
        const d = parseFloat(line.substring(8).split(',')[0]);
        if (!isNaN(d)) {
          durationSum += d;
          segCount++;
        }
      }
    }

    videoTracks.push({
      id: 'default-stream',
      resolution: 'original',
      bandwidth: 2500000,
      codecs: 'avc1.4d401f, mp4a.40.2',
      url: manifestUrl,
      segmentsCount: segCount,
    });
    if (targetDuration === 0 && segCount > 0) {
      targetDuration = Math.round(durationSum / segCount);
    }
  }

  // Sort video tracks by bandwidth descending
  videoTracks.sort((a, b) => b.bandwidth - a.bandwidth);

  return {
    isMaster,
    manifestType: 'hls',
    targetDuration,
    videoTracks,
    audioTracks,
    isSeparateAudioVideo: audioTracks.length > 0,
  };
}

/**
 * Extracts list of segments from a media playlist M3U8 string.
 */
export function extractMediaSegments(
  content: string,
  playlistUrl: string,
  type: 'video' | 'audio' | 'combined' = 'combined'
): MediaSegment[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const segments: MediaSegment[] = [];
  let currentDuration = 6.0;
  let index = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Initialization segment (fMP4)
    if (line.startsWith('#EXT-X-MAP:')) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch) {
        segments.push({
          index: index++,
          url: resolveRelativeUrl(playlistUrl, uriMatch[1]),
          duration: 0,
          isInitSegment: true,
          type,
          status: 'pending',
          attempts: 0,
          bytes: 0,
        });
      }
    } else if (line.startsWith('#EXTINF:')) {
      const d = parseFloat(line.substring(8).split(',')[0]);
      if (!isNaN(d)) {
        currentDuration = d;
      }
    } else if (!line.startsWith('#')) {
      // Segment URI
      segments.push({
        index: index++,
        url: resolveRelativeUrl(playlistUrl, line),
        duration: currentDuration,
        type,
        status: 'pending',
        attempts: 0,
        bytes: 0,
      });
    }
  }

  return segments;
}

/**
 * Fetches and parses an online HLS manifest URL into VideoInfo.
 */
export async function getHlsVideoInfo(url: string, fetchFn = fetch): Promise<VideoInfo> {
  const response = await fetchFn(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VideoDownloaderPro/2.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch HLS manifest: HTTP ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  const analysis = parseM3U8Content(content, url);

  const availableQualities: QualityOption[] = [];
  const availableAudioFormats: QualityOption[] = [];

  if (analysis.isMaster && analysis.videoTracks.length > 0) {
    for (const track of analysis.videoTracks) {
      let resLabel: any = 'original';
      let height = 720;

      if (track.resolution.includes('x')) {
        const h = parseInt(track.resolution.split('x')[1], 10);
        height = h;
        if (h >= 1080) resLabel = '1080p';
        else if (h >= 720) resLabel = '720p';
        else if (h >= 480) resLabel = '480p';
        else if (h >= 360) resLabel = '360p';
        else if (h >= 240) resLabel = '240p';
        else resLabel = '144p';
      }

      availableQualities.push({
        id: `hls-${resLabel}-${track.bandwidth}`,
        resolution: resLabel,
        label: `${resLabel} (${track.resolution !== 'adaptive' ? track.resolution : `${Math.round(track.bandwidth / 1000)} kbps`})`,
        height,
        bitrate: track.bandwidth,
        format: 'mp4',
        videoCodec: track.codecs,
        manifestUrl: track.url,
      });
    }
  } else {
    availableQualities.push({
      id: 'hls-original',
      resolution: 'best',
      label: 'Original Stream Quality',
      height: 720,
      bitrate: 2500000,
      format: 'mp4',
      manifestUrl: url,
    });
  }

  // Audio only extraction
  availableAudioFormats.push({
    id: 'audio-mp3-320',
    resolution: 'original',
    label: 'MP3 High Quality (320 kbps)',
    height: 0,
    bitrate: 320000,
    format: 'mp3',
    audioCodec: 'mp3',
    isAudioOnly: true,
    manifestUrl: analysis.audioTracks[0]?.url || url,
  });
  availableAudioFormats.push({
    id: 'audio-aac-original',
    resolution: 'original',
    label: 'Original Audio Track (AAC)',
    height: 0,
    bitrate: 192000,
    format: 'mp3',
    audioCodec: 'aac',
    isAudioOnly: true,
    manifestUrl: analysis.audioTracks[0]?.url || url,
  });

  return {
    id: `stream-${Buffer.from(url).toString('base64url').slice(0, 16)}`,
    url,
    title: 'HLS Live/VOD Stream',
    description: `Direct HLS Stream with ${analysis.videoTracks.length} video tracks and ${analysis.audioTracks.length} audio tracks.`,
    thumbnail: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=640&q=80',
    durationSeconds: 0,
    durationFormatted: 'Live / Variable',
    platform: 'HLS Stream',
    platformCategory: 'hls',
    availableQualities,
    availableAudioFormats,
    isAuthorized: true,
    permissionStatus: 'authorized',
    isStream: true,
    manifestType: 'hls',
  };
}
