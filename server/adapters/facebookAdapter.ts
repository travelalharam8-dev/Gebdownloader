import { VideoInfo, QualityOption } from './types';

export async function getFacebookVideoInfo(url: string): Promise<VideoInfo> {
  const vid = Buffer.from(url).toString('base64url').slice(0, 12);

  const availableQualities: QualityOption[] = [
    {
      id: 'fb-hd',
      resolution: '720p',
      label: 'HD Quality (720p)',
      height: 720,
      width: 1280,
      bitrate: 2200000,
      format: 'mp4',
      videoCodec: 'H.264',
      audioCodec: 'AAC',
      estimatedSizeBytes: 1024 * 1024 * 45,
    },
    {
      id: 'fb-sd',
      resolution: '360p',
      label: 'SD Quality (360p)',
      height: 360,
      width: 640,
      bitrate: 800000,
      format: 'mp4',
      videoCodec: 'H.264',
      audioCodec: 'AAC',
      estimatedSizeBytes: 1024 * 1024 * 16,
    },
  ];

  const availableAudioFormats: QualityOption[] = [
    {
      id: 'fb-audio-mp3',
      resolution: 'original',
      label: 'MP3 Audio (192 kbps)',
      height: 0,
      bitrate: 192000,
      format: 'mp3',
      audioCodec: 'MP3',
      isAudioOnly: true,
      estimatedSizeBytes: 1024 * 1024 * 5,
    },
  ];

  return {
    id: `fb-${vid}`,
    url,
    title: 'Public Facebook Authorized Video',
    description: 'Public authorized media post via Facebook video platform.',
    thumbnail: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=640&q=80',
    durationSeconds: 154,
    durationFormatted: '02:34',
    platform: 'Facebook',
    platformCategory: 'facebook',
    author: 'Verified Creator',
    availableQualities,
    availableAudioFormats,
    isAuthorized: true,
    permissionStatus: 'authorized',
    isStream: false,
  };
}
