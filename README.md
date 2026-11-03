# Video Downloader Pro (v2.0)
### Complete Windows Desktop Application & Media Processing Engine

Video Downloader Pro is a professional Windows desktop application and high-performance media processing engine built with Electron, Node.js, Express, and FFmpeg. It provides real-time streaming analysis, HLS/DASH manifest parsing, audio/video track reconstruction, durable persistent queue management, and full Arabic (RTL) / English (LTR) language support.

---

## Key Features

1. **Windows Desktop Application (.exe)**:
   - Packaged with Electron Builder.
   - Generates `VideoDownloaderPro-Setup.exe` (NSIS installer) and `VideoDownloaderPro.exe` (portable).
   - Auto-starts and safely terminates child backend services.
   - Secure context isolation (`nodeIntegration: false`, `contextIsolation: true`).

2. **Single-File Frontend (`index.html`)**:
   - Complete self-contained HTML5, CSS styles, and Vanilla JavaScript inside `index.html`.
   - Dark purple/blue glassmorphism theme, smooth animations, and responsive layout.
   - 100% Arabic (RTL) and English (LTR) dual-language switcher with persistent preference.

3. **Multi-Source Platform Support**:
   - **YouTube**: Authorized video metadata, 1080p Full HD, 720p HD, 480p, 360p, MP3 audio, and playlist bulk ingestion.
   - **Facebook**: Public authorized video detection and HD extraction.
   - **Educational Platforms (e.g. Almentor / المنتور)**: Multi-lesson manifest discovery, authorized export checks, and course structuring. Honest limitation reporting for DRM-protected or unauthorized sources.
   - **Direct HLS (.m3u8)**: Master playlist analysis, bandwidth variants, separate audio tracks, and fMP4 init maps.
   - **Direct MPEG-DASH (.mpd)**: XML MPD parser, adaptation sets, representations, and chunk indexing.

4. **14-Stage Streaming & Media Reconstruction Pipeline**:
   - Real-time progression across 14 deterministic stages:
     1. Source validation (SSRF guard & protocol inspection)
     2. Permission verification (License & authorized tokens)
     3. Manifest analysis (M3U8 / MPD structure)
     4. Stream detection (Adaptive bitrate detection)
     5. Video track detection
     6. Audio track detection
     7. Segment processing (Bounded concurrent worker pool)
     8. Video reconstruction (fMP4 / TS stream assembly)
     9. Audio reconstruction (Independent audio track extraction)
     10. Audio/video synchronization (PTS/DTS alignment)
     11. Final merging
     12. FFmpeg processing (Fast remuxing / MP3 transcode)
     13. File validation (Integrity & byte-size check)
     14. Download readiness (Secure tokenized link generation)

5. **Durable Download Queue & History**:
   - On-disk persistence (`data/downloads.json`).
   - Configurable concurrency (1 to 4 simultaneous downloads).
   - Live speed (MB/s), ETA calculations, and retry capability.
   - Expiring secure tokens (`/api/download/file/:token`) with HTTP Range request support.

---

## Project Structure

```text
├── index.html                    # Single-file frontend (HTML5 + CSS + Vanilla JS)
├── server.ts                     # Full-stack entry point (Express + Vite middlewares)
├── metadata.json                 # AI Studio Applet metadata
├── package.json                  # Dependencies, scripts, and build targets
├── electron-builder.json         # Windows installer & portable packaging configuration
├── electron/
│   ├── main.cjs                  # Electron main process (lifecycle & backend supervisor)
│   └── preload.cjs               # Secure contextBridge API
├── server/
│   ├── routes/
│   │   └── api.ts                # 14+ REST API endpoints
│   ├── security/
│   │   └── urlValidator.ts       # SSRF protection, IP filtering, platform classifier
│   ├── adapters/
│   │   ├── types.ts              # Unified media and segment interfaces
│   │   ├── hlsAdapter.ts         # M3U8 master/media playlist parser
│   │   ├── dashAdapter.ts        # MPEG-DASH MPD manifest parser
│   │   ├── youtubeAdapter.ts     # YouTube oEmbed & format resolver
│   │   ├── facebookAdapter.ts    # Facebook video metadata
│   │   └── educationalAdapter.ts # Educational & Almentor platform adapter
│   ├── engine/
│   │   ├── segmentEngine.ts      # Chunk downloader, disk streaming, and worker pool
│   │   └── mediaReconstruction.ts# FFmpeg multiplexer & audio/video synchronizer
│   ├── queue/
│   │   └── queueManager.ts       # Durable queue state machine & disk persistence
│   └── storage/
│       └── storageManager.ts     # Secure temporary token issuer & disk cleanup
└── tests/
    ├── urlValidator.test.ts      # SSRF & classification unit tests
    ├── m3u8Parser.test.ts        # HLS manifest & segment unit tests
    └── queueManager.test.ts      # Queue lifecycle & settings unit tests
```

---

## Windows Packaging & Build Instructions

### 1. Build the Windows Executable (.exe)
To generate the Windows installer and portable executable:

```bash
# 1. Install dependencies
npm install

# 2. Build production assets
npm run build

# 3. Package Windows Installer (NSIS) and Portable EXE
npm run build:win
```

**Generated Deliverables:**
- `dist-electron/VideoDownloaderPro-Setup.exe` (Complete Windows installer with desktop and start menu shortcuts)
- `dist-electron/VideoDownloaderPro.exe` (Standalone portable Windows executable)

### 2. Development Mode
To run the full-stack application locally in browser or Electron:

```bash
# Start backend and web preview on http://localhost:3000
npm run dev

# Run Electron desktop window
npm run electron:dev
```

### 3. Run Unit Tests
```bash
npm run test
```

---

## API Documentation

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Backend and FFmpeg health diagnostics |
| `POST` | `/api/video/info` | Analyzes URL, SSRF checks, extracts formats and authorization status |
| `POST` | `/api/playlist/info` | Ingests playlist or educational course modules |
| `POST` | `/api/download` | Enqueues a single download job with selected quality/format |
| `POST` | `/api/download/bulk` | Batch enqueues multiple items from a playlist |
| `POST` | `/api/download-links` | Generates verified, temporary direct download token for a file |
| `POST` | `/api/playlist/download-links` | Generates bulk one-per-line verified links for clipboard |
| `GET` | `/api/download/status/:id` | Polls real-time job progress, speed, ETA, and stage status |
| `GET` | `/api/download/file/:token` | Streams completed media file with HTTP Range support |
| `GET` | `/api/queue` | Returns all active and queued processing jobs |
| `GET` | `/api/history` | Returns completed and failed downloads history |
| `POST` | `/api/download/retry/:id` | Retries a failed download job |
| `DELETE` | `/api/history/:id` | Removes an entry from history |
| `POST` | `/api/stream/info` | Inspects HLS/DASH manifest representations and tracks |
| `POST` | `/api/stream/process` | Starts full 14-stage stream reconstruction (One-click full video) |
| `GET` | `/api/stream/status/:id` | Real-time stage inspection and segment metrics |
| `GET` | `/api/settings` | Retrieves application settings |
| `POST` | `/api/settings` | Updates concurrency and retention parameters |

---

## Security & Compliance

- **SSRF Protection**: Strict server-side URL validation blocks loopback (127.0.0.1), private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local/cloud metadata (169.254.169.254), and local domains.
- **DRM & Copyright Compliance**: Never bypasses DRM, encryption, or subscription access controls. If an educational course or video requires official credentials that are missing, it honestly displays: *"Downloading is not available for this content through the current integration."*
- **Expiring Links**: Generated download links use cryptographic tokens that expire after 24 hours.
