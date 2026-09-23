'use strict';

/**
 * Utilitas bersama untuk memindahkan gambar dari stack lama (v1/v2) ke
 * penyimpanan NG sendiri (`src/uploads`, sebuah volume persisten).
 *
 * Dipakai oleh:
 *   - scripts/importLegacyActivities.js  (impor kegiatan dari v1)
 *   - scripts/rehostActivityImages.js    (perbaiki baris yang sudah ada)
 *
 * Daftar host sengaja ditaruh di satu tempat: stack v1 dan v2 akan
 * dihentikan, jadi tidak boleh ada URL tersisa yang menunjuk ke sana.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const UPLOAD_DIR = path.resolve(__dirname, '../../src/uploads');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Host stack lama yang isinya harus dipindah ke NG sebelum dimatikan. */
const LEGACY_IMAGE_HOSTS = new Set([
  'upload00.iom-itb.id', // stack v1
  'api.upload.iom-itb.id', // stack v1 (nama lama)
  'iom-apiv2.iom-itb.id', // stack v2
  'api.upload-iom-itb.195.110.58.17.sslip.io', // sudah mati — tetap didaftarkan agar dilaporkan
]);

const IMAGE_EXT_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const isLegacyImageUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    if (LEGACY_IMAGE_HOSTS.has(host)) return true;
    // Jalur lama pada domain api utama.
    return host === 'api.iom-itb.id' && url.pathname.startsWith('/uploads/');
  } catch {
    return false;
  }
};

const getExtension = (urlString, contentType) => {
  let fromUrl = '';
  try {
    fromUrl = path.extname(new URL(urlString).pathname).toLowerCase();
  } catch {
    fromUrl = '';
  }
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fromUrl)) {
    return fromUrl === '.jpeg' ? '.jpg' : fromUrl;
  }
  const cleanContentType = String(contentType || '').split(';')[0].trim().toLowerCase();
  return IMAGE_EXT_BY_TYPE[cleanContentType] || '.jpg';
};

const requestBuffer = (urlString, redirectCount = 0) => new Promise((resolve, reject) => {
  if (redirectCount > 5) {
    reject(new Error(`Too many redirects for ${urlString}`));
    return;
  }

  const url = new URL(urlString);
  const client = url.protocol === 'https:' ? https : http;
  const req = client.get(url, { timeout: 20000 }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      const nextUrl = new URL(res.headers.location, url).toString();
      requestBuffer(nextUrl, redirectCount + 1).then(resolve).catch(reject);
      return;
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      res.resume();
      reject(new Error(`HTTP ${res.statusCode} while downloading ${urlString}`));
      return;
    }

    const chunks = [];
    let total = 0;
    res.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_IMAGE_BYTES) {
        req.destroy(new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes: ${urlString}`));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve({
      buffer: Buffer.concat(chunks),
      contentType: res.headers['content-type'] || '',
    }));
  });

  req.on('timeout', () => req.destroy(new Error(`Timeout while downloading ${urlString}`)));
  req.on('error', reject);
});

/**
 * Unduh gambar ke UPLOAD_DIR bila host-nya termasuk stack lama, lalu
 * kembalikan URL barunya. Idempoten: nama berkas diturunkan dari hash URL
 * asal, jadi menjalankan ulang tidak menggandakan berkas.
 */
const mirrorImage = async ({ prefix, imageUrl, baseUrl }) => {
  if (!isLegacyImageUrl(imageUrl)) {
    return { finalUrl: imageUrl, mirrored: false, reused: false, warning: null };
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const hash = crypto.createHash('sha1').update(imageUrl).digest('hex').slice(0, 12);
  const placeholderName = `${prefix}-${hash}`;
  const existing = fs.readdirSync(UPLOAD_DIR).find((file) => file.startsWith(`${placeholderName}.`));

  if (existing) {
    return {
      finalUrl: `${baseUrl}/uploads/${existing}`,
      mirrored: true,
      reused: true,
      warning: null,
    };
  }

  try {
    const { buffer, contentType } = await requestBuffer(imageUrl);
    const cleanContentType = String(contentType || '').split(';')[0].trim().toLowerCase();
    if (!cleanContentType.startsWith('image/')) {
      return {
        finalUrl: imageUrl,
        mirrored: false,
        reused: false,
        warning: `Downloaded file is not an image: ${contentType || 'unknown content-type'}`,
      };
    }

    const extension = getExtension(imageUrl, contentType);
    const filename = `${placeholderName}${extension}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);

    return {
      finalUrl: `${baseUrl}/uploads/${filename}`,
      mirrored: true,
      reused: false,
      warning: null,
    };
  } catch (error) {
    return {
      finalUrl: imageUrl,
      mirrored: false,
      reused: false,
      warning: error.message,
    };
  }
};

module.exports = {
  UPLOAD_DIR,
  MAX_IMAGE_BYTES,
  LEGACY_IMAGE_HOSTS,
  isLegacyImageUrl,
  getExtension,
  requestBuffer,
  mirrorImage,
};
