export type QualityResolution =
  | '144p'
  | '240p'
  | '360p'
  | '480p'
  | '720p'
  | '1080p'
  | 'original'
  | 'best';

export interface QualityOption {
  id: string;
  resolution: QualityResolution;
  label: string;
  height: number;
  width?: number;
  bitrate?: number;
  format: 'mp4' | 'mp3' | 'webm' | 'ts';
  audioCodec?: string;
  videoCodec?: string;
  estimatedSizeBytes?: number;
  isAudioOnly?: boolean;
  manifestUrl?: string;
}

export interface VideoInfo {
  id: string;
  url: string;
  title: string;
  description: string;
  thumbnail: string;
  durationSeconds: number;
  durationFormatted: string;
  platform: string;
  platformCategory: string;
  author?: string;
  availableQualities: QualityOption[];
  availableAudioFormats: QualityOption[];
  isAuthorized: boolean;
  permissionStatus: 'authorized' | 'restricted' | 'drm_protected' | 'unsupported';
  permissionMessage?: string;
  isStream: boolean;
  manifestType?: 'hls' | 'dash' | 'direct';
}

export interface PlaylistItem {
  id: string;
  index: number;
  title: string;
  thumbnail: string;
  durationSeconds: number;
  durationFormatted: string;
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'ineligible';
  selectedQuality?: string;
  selectedFormat?: 'mp4' | 'mp3';
  fileSizeFormatted?: string;
  error?: string;
}

export interface PlaylistInfo {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  author: string;
  totalVideos: number;
  videos: PlaylistItem[];
  platform: string;
}

export interface MediaSegment {
  index: number;
  url: string;
  duration: number; // in seconds
  byteRange?: string;
  isInitSegment?: boolean;
  type: 'video' | 'audio' | 'combined';
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  attempts: number;
  bytes: number;
}

export interface ManifestAnalysisResult {
  isMaster: boolean;
  manifestType: 'hls' | 'dash';
  targetDuration: number;
  videoTracks: Array<{
    id: string;
    resolution: string;
    bandwidth: number;
    codecs: string;
    url: string;
    segmentsCount?: number;
  }>;
  audioTracks: Array<{
    id: string;
    language: string;
    bandwidth: number;
    codecs: string;
    url: string;
    segmentsCount?: number;
  }>;
  isSeparateAudioVideo: boolean;
}
