import { downloadImage } from '../sheet-news.js';

/** Download Drive images without reading a sheet or checking dates/columns. */
export class DriveImageDownloader {
  constructor({
    outputDir = process.env.NEWS_IMAGE_DIR || './downloads/drive',
    getAccessToken = async () => {
      const auth = await import('./google-auth.js');
      return auth.getGoogleAccessToken();
    },
    timeoutMs = 60000,
    maxBytes = 25 * 1024 * 1024,
    fetchImpl = fetch,
  } = {}) {
    this.options = { outputDir, getAccessToken, timeoutMs, maxBytes, fetchImpl };
  }

  /**
   * @param {string} fileIdOrUrl Drive file ID or https://drive.google.com file link.
   * @returns {Promise<{localPath:string,mimeType:string,sizeBytes:number,sha256:string,sourceUrl:string}>}
   */
  async download(fileIdOrUrl) {
    if (typeof fileIdOrUrl !== 'string' || !fileIdOrUrl.trim()) {
      throw new Error('Provide a Google Drive file ID or file link');
    }
    const value = fileIdOrUrl.trim();
    let url;
    if (/^[A-Za-z0-9_-]+$/.test(value)) {
      url = `https://drive.google.com/file/d/${value}/view`;
    } else {
      let parsed;
      try { parsed = new URL(value); } catch {
        throw new Error('Invalid Google Drive file ID or file link');
      }
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'drive.google.com' || parsed.username || parsed.password) {
        throw new Error('Use an HTTPS Google Drive file link');
      }
      url = parsed.href;
    }
    return downloadImage(url, { ...this.options, prefix: 'drive-image' });
  }
}

export default DriveImageDownloader;
