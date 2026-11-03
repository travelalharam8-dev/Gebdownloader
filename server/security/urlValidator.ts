import { URL } from 'node:url';

export type PlatformType =
  | 'youtube'
  | 'facebook'
  | 'educational'
  | 'hls'
  | 'dash'
  | 'direct_media'
  | 'unknown';

export interface ValidationResult {
  isValid: boolean;
  normalizedUrl?: string;
  platform: PlatformType;
  platformName: string;
  isPlaylist?: boolean;
  playlistId?: string;
  videoId?: string;
  error?: string;
  isDirectStream?: boolean;
}

// IP ranges that MUST be blocked for SSRF protection
const BLOCKED_IP_PATTERNS = [
  /^127\./,                          // 127.0.0.0/8 Loopback
  /^0\./,                            // 0.0.0.0/8
  /^10\./,                           // 10.0.0.0/8 Private
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12 Private
  /^192\.168\./,                     // 192.168.0.0/16 Private
  /^169\.254\./,                     // 169.254.0.0/16 Link-local / Cloud Metadata
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
  /^localhost$/i,                    // localhost hostname
];

/**
 * Validates a target URL against SSRF vulnerabilities and protocol restrictions.
 */
export function validateUrlSecurity(urlString: string): { safe: boolean; error?: string; urlObj?: URL } {
  if (!urlString || typeof urlString !== 'string') {
    return { safe: false, error: 'URL is required' };
  }

  const trimmed = urlString.trim();
  if (trimmed.length > 2048) {
    return { safe: false, error: 'URL exceeds maximum length limit' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { safe: false, error: 'Malformed or invalid URL syntax' };
  }

  // Only allow standard http and https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, error: `Unauthorized protocol: ${parsed.protocol}. Only HTTP and HTTPS are permitted.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block forbidden hostnames and IPs
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { safe: false, error: 'Access to private or local network resources is restricted (SSRF Protection).' };
    }
  }

  // Block internal domain suffixes
  if (
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.lan')
  ) {
    return { safe: false, error: 'Access to local domain addresses is restricted.' };
  }

  return { safe: true, urlObj: parsed };
}

/**
 * Classifies an allowed URL into its detected platform category and extracts metadata hints.
 */
export function classifyUrl(urlString: string): ValidationResult {
  const securityCheck = validateUrlSecurity(urlString);
  if (!securityCheck.safe || !securityCheck.urlObj) {
    return {
      isValid: false,
      platform: 'unknown',
      platformName: 'Unknown',
      error: securityCheck.error || 'Invalid URL',
    };
  }

  const { urlObj } = securityCheck;
  const host = urlObj.hostname.toLowerCase();
  const path = urlObj.pathname.toLowerCase();

  // 1. YouTube
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    const listId = urlObj.searchParams.get('list');
    let videoId = urlObj.searchParams.get('v');

    if (host.includes('youtu.be')) {
      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        videoId = parts[0];
      }
    }

    const isPlaylist = !!listId && (!videoId || urlObj.pathname.includes('/playlist'));

    return {
      isValid: true,
      normalizedUrl: urlObj.toString(),
      platform: 'youtube',
      platformName: 'YouTube',
      isPlaylist,
      playlistId: listId || undefined,
      videoId: videoId || undefined,
    };
  }

  // 2. Facebook
  if (host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.com')) {
    return {
      isValid: true,
      normalizedUrl: urlObj.toString(),
      platform: 'facebook',
      platformName: 'Facebook',
      isPlaylist: false,
    };
  }

  // 3. Educational Platforms (e.g. Almentor / المنتور)
  if (
    host.includes('almentor.net') ||
    host.includes('almentor.org') ||
    host.includes('coursera.org') ||
    host.includes('udemy.com') ||
    host.includes('edx.org')
  ) {
    const isAlmentor = host.includes('almentor');
    const isPlaylist = path.includes('/course') || path.includes('/program') || path.includes('/track');

    return {
      isValid: true,
      normalizedUrl: urlObj.toString(),
      platform: 'educational',
      platformName: isAlmentor ? 'Almentor (المنتور)' : 'Educational Platform',
      isPlaylist,
    };
  }

  // 4. Direct HLS Stream (.m3u8)
  if (path.endsWith('.m3u8') || urlObj.searchParams.get('format') === 'm3u8') {
    return {
      isValid: true,
      normalizedUrl: urlObj.toString(),
      platform: 'hls',
      platformName: 'HLS Stream (M3U8)',
      isDirectStream: true,
    };
  }

  // 5. Direct MPEG-DASH Stream (.mpd)
  if (path.endsWith('.mpd') || urlObj.searchParams.get('format') === 'mpd') {
    return {
      isValid: true,
      normalizedUrl: urlObj.toString(),
      platform: 'dash',
      platformName: 'MPEG-DASH (MPD)',
      isDirectStream: true,
    };
  }

  // 6. Direct media files (.mp4, .webm, .mkv, .mp3, .m4a)
  if (/\.(mp4|webm|mkv|mp3|m4a|aac|flv)$/i.test(path)) {
    return {
      isValid: true,
      normalizedUrl: urlObj.toString(),
      platform: 'direct_media',
      platformName: 'Direct Media File',
      isDirectStream: true,
    };
  }

  // Generic recognized HTTP web media
  return {
    isValid: true,
    normalizedUrl: urlObj.toString(),
    platform: 'unknown',
    platformName: 'Generic Media Source',
  };
}
