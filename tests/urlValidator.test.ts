import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUrlSecurity, classifyUrl } from '../server/security/urlValidator';

test('SSRF: blocks private IP ranges (127.0.0.1, 10.x, 192.168.x)', () => {
  assert.equal(validateUrlSecurity('http://127.0.0.1/video.mp4').safe, false);
  assert.equal(validateUrlSecurity('http://localhost:8080/stream.m3u8').safe, false);
  assert.equal(validateUrlSecurity('http://192.168.1.1/secret').safe, false);
  assert.equal(validateUrlSecurity('http://10.0.0.5/api').safe, false);
  assert.equal(validateUrlSecurity('http://169.254.169.254/latest/meta-data').safe, false);
});

test('SSRF: rejects non-http/https protocols', () => {
  assert.equal(validateUrlSecurity('file:///etc/passwd').safe, false);
  assert.equal(validateUrlSecurity('ftp://server/media.mp4').safe, false);
  assert.equal(validateUrlSecurity('gopher://internal/').safe, false);
});

test('Classification: accurately classifies YouTube videos and playlists', () => {
  const videoResult = classifyUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(videoResult.isValid, true);
  assert.equal(videoResult.platform, 'youtube');
  assert.equal(videoResult.videoId, 'dQw4w9WgXcQ');

  const playlistResult = classifyUrl('https://www.youtube.com/playlist?list=PL_sample123');
  assert.equal(playlistResult.isValid, true);
  assert.equal(playlistResult.platform, 'youtube');
  assert.equal(playlistResult.isPlaylist, true);
  assert.equal(playlistResult.playlistId, 'PL_sample123');
});

test('Classification: recognizes Educational Almentor and HLS/DASH streams', () => {
  const almentorResult = classifyUrl('https://www.almentor.net/courses/master-software-engineering');
  assert.equal(almentorResult.isValid, true);
  assert.equal(almentorResult.platform, 'educational');

  const hlsResult = classifyUrl('https://cdn.example.com/live/master.m3u8');
  assert.equal(hlsResult.isValid, true);
  assert.equal(hlsResult.platform, 'hls');
  assert.equal(hlsResult.isDirectStream, true);

  const dashResult = classifyUrl('https://cdn.example.com/vod/stream.mpd');
  assert.equal(dashResult.isValid, true);
  assert.equal(dashResult.platform, 'dash');
  assert.equal(dashResult.isDirectStream, true);
});
