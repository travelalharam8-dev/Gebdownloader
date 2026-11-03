import test from 'node:test';
import assert from 'node:assert/strict';
import { parseM3U8Content, extractMediaSegments } from '../server/adapters/hlsAdapter';

test('HLS Parser: parses master playlist with audio and video variants', () => {
  const masterManifest = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-aac",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="audio/aac/prog_index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3800000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio-aac"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2100000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio-aac"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42e01e,mp4a.40.2",AUDIO="audio-aac"
360p/index.m3u8
`;

  const analysis = parseM3U8Content(masterManifest, 'https://cdn.test.com/stream/master.m3u8');
  assert.equal(analysis.isMaster, true);
  assert.equal(analysis.manifestType, 'hls');
  assert.equal(analysis.videoTracks.length, 3);
  assert.equal(analysis.videoTracks[0].resolution, '1920x1080');
  assert.equal(analysis.videoTracks[0].url, 'https://cdn.test.com/stream/1080p/index.m3u8');
  assert.equal(analysis.audioTracks.length, 1);
  assert.equal(analysis.audioTracks[0].url, 'https://cdn.test.com/stream/audio/aac/prog_index.m3u8');
  assert.equal(analysis.isSeparateAudioVideo, true);
});

test('HLS Parser: extracts media segments and fMP4 init maps', () => {
  const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-VERSION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.000,
seg_001.mp4
#EXTINF:5.800,
seg_002.mp4
#EXT-X-ENDLIST
`;

  const segments = extractMediaSegments(mediaPlaylist, 'https://cdn.test.com/stream/1080p/index.m3u8', 'video');
  assert.equal(segments.length, 3);
  assert.equal(segments[0].isInitSegment, true);
  assert.equal(segments[0].url, 'https://cdn.test.com/stream/1080p/init.mp4');
  assert.equal(segments[1].duration, 6.0);
  assert.equal(segments[1].url, 'https://cdn.test.com/stream/1080p/seg_001.mp4');
  assert.equal(segments[2].duration, 5.8);
});
