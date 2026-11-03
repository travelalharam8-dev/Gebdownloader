import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface DownloadToken {
  token: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: number;
  expiresAt: number;
}

export class StorageManager {
  private baseDir: string;
  private downloadsDir: string;
  private tempDir: string;
  private tokens: Map<string, DownloadToken> = new Map();

  constructor(workspaceRoot = process.cwd()) {
    this.baseDir = path.join(workspaceRoot, 'storage');
    this.downloadsDir = path.join(this.baseDir, 'downloads');
    this.tempDir = path.join(this.baseDir, 'temp');

    fs.mkdirSync(this.downloadsDir, { recursive: true });
    fs.mkdirSync(this.tempDir, { recursive: true });
  }

  getDownloadsDir(): string {
    return this.downloadsDir;
  }

  getTempDir(): string {
    return this.tempDir;
  }

  /**
   * Generates a secure, temporary, expiring download token for a completed file.
   */
  generateDownloadToken(filePath: string, fileName?: string, expiryMs = 24 * 60 * 60 * 1000): DownloadToken {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Cannot generate download token: file does not exist at ${filePath}`);
    }

    const stat = fs.statSync(filePath);
    const resolvedName = fileName || path.basename(filePath);
    const ext = path.extname(resolvedName).toLowerCase();
    const mimeType = ext === '.mp3' ? 'audio/mpeg' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';

    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();

    const tokenData: DownloadToken = {
      token,
      filePath,
      fileName: resolvedName,
      mimeType,
      fileSizeBytes: stat.size,
      createdAt: now,
      expiresAt: now + expiryMs,
    };

    this.tokens.set(token, tokenData);
    return tokenData;
  }

  getToken(token: string): DownloadToken | null {
    const data = this.tokens.get(token);
    if (!data) return null;
    if (Date.now() > data.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    return data;
  }

  /**
   * Automatic cleanup of old temporary files based on retention policy.
   */
  cleanExpiredFiles(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
    let cleaned = 0;
    const now = Date.now();

    // Clean expired tokens
    for (const [key, data] of this.tokens.entries()) {
      if (now > data.expiresAt) {
        this.tokens.delete(key);
      }
    }

    // Clean old files in temp
    try {
      if (fs.existsSync(this.tempDir)) {
        const entries = fs.readdirSync(this.tempDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(this.tempDir, entry.name);
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs > maxAgeMs) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            cleaned++;
          }
        }
      }
    } catch {
      // Ignore cleanup error
    }

    return cleaned;
  }
}

export const storageManager = new StorageManager();
