#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const sanitizeHtml = require('sanitize-html');

const { Activities, sequelize } = require('../src/models');

sequelize.options.logging = false;

const UPLOAD_DIR = path.resolve(__dirname, '../src/uploads');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIRROR_HOSTS = new Set([
  'upload00.iom-itb.id',
  'api.upload.iom-itb.id',
]);

const IMAGE_EXT_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const parseArgs = (argv) => {
  const args = {
    dryRun: false,
    apply: false,
    forceUpdate: false,
    file: null,
    report: null,
    baseUrl: process.env.BASE_URL || process.env.API_BASE_URL || '',
  };

  argv.forEach((arg) => {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--force-update') args.forceUpdate = true;
    else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length);
    else if (arg.startsWith('--report=')) args.report = arg.slice('--report='.length);
    else if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length);
  });

  if (args.dryRun === args.apply) {
    throw new Error('Use exactly one mode: --dry-run or --apply');
  }
  if (!args.file) {
    throw new Error('Missing --file=/path/to/activities.json');
  }
  if (!args.report) {
    args.report = args.dryRun
      ? path.resolve(process.cwd(), 'migration-reports/activities-dry-run.json')
      : path.resolve(process.cwd(), 'migration-reports/activities-apply.json');
  }
  if (!args.baseUrl && args.apply) {
    throw new Error('Missing --base-url=https://api.example.com for apply mode');
  }

  args.file = path.resolve(process.cwd(), args.file);
  args.report = path.resolve(process.cwd(), args.report);
  args.baseUrl = args.baseUrl.replace(/\/+$/, '');

  return args;
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sanitizeDescription = (html) => sanitizeHtml(html, {
  allowedTags: [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'em', 'u', 's', 'blockquote',
    'ul', 'ol', 'li', 'img', 'a', 'br', 'div', 'iframe'
  ],
  allowedAttributes: {
    img: ['src', 'alt', 'style'],
    a: ['href', 'target', 'rel'],
    p: ['style'],
    h1: ['style'],
    h2: ['style'],
    h3: ['style'],
    div: ['data-youtube-video'],
    iframe: [
      'src', 'width', 'height',
      'allowfullscreen', 'autoplay',
      'disablekbcontrols', 'enableiframeapi',
      'endtime', 'ivloadpolicy', 'loop',
      'modestbranding', 'origin', 'playlist',
      'rel', 'start', 'frameborder', 'allow'
    ],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
      width: [/^\d+(%|px)$/],
      height: [/.*/],
    },
  },
  allowedSchemesByTag: {
    img: ['https', 'http'],
    a: ['https', 'http'],
    iframe: ['https'],
  },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
    })
  }
});

const slugify = (value) => {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return slug.slice(0, 180).replace(/-+$/g, '');
};

const isAbsoluteHttpUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

const normalizeDateOnly = (value) => {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const mapped = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${mapped.year}-${mapped.month}-${mapped.day}`;
};

const dateForDatabase = (dateOnly) => new Date(`${dateOnly}T12:00:00+07:00`);

const linkifyPlainText = (value) => {
  const escaped = escapeHtml(value);
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const cleanUrl = url.replace(/[),.;]+$/g, '');
    const trailing = url.slice(cleanUrl.length);
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
  });
};

const paragraphToHtml = (block) => {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return '';

  const bulletLines = lines.filter(line => /^([-•])\s+/.test(line));
  if (bulletLines.length === lines.length) {
    const items = lines
      .map(line => line.replace(/^([-•])\s+/, ''))
      .map(line => `<li>${linkifyPlainText(line)}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  }

  return `<p>${lines.map(linkifyPlainText).join('<br>')}</p>`;
};

const buildDescriptionHtml = (description, externalUrl) => {
  const normalized = String(description || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = normalized.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  const html = blocks.map(paragraphToHtml).filter(Boolean);

  if (externalUrl) {
    const safeUrl = escapeHtml(externalUrl);
    html.push(`<p><strong>Link terkait:</strong> <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Buka informasi terkait</a></p>`);
  }

  return sanitizeDescription(html.join('\n'));
};

const shouldMirrorImage = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    if (MIRROR_HOSTS.has(host)) return true;
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

const mirrorImage = async ({ legacyId, imageUrl, baseUrl }) => {
  if (!shouldMirrorImage(imageUrl)) {
    return { finalUrl: imageUrl, mirrored: false, reused: false, warning: null };
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const hash = crypto.createHash('sha1').update(imageUrl).digest('hex').slice(0, 12);
  const placeholderName = `legacy-activity-${legacyId}-${hash}`;
  const existing = fs.readdirSync(UPLOAD_DIR).find(file => file.startsWith(`${placeholderName}.`));

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

const sameActivity = (activity, row) => {
  if (!activity) return false;
  const titleMatches = String(activity.title || '').trim() === String(row.title || '').trim();
  const activityDate = normalizeDateOnly(activity.date);
  const rowDate = normalizeDateOnly(row.date);
  return titleMatches && activityDate === rowDate;
};

const getPreferredSlug = (row) => {
  const legacyUrl = String(row.url || '').trim();
  if (legacyUrl && !isAbsoluteHttpUrl(legacyUrl)) {
    const fromLegacyUrl = slugify(legacyUrl);
    if (fromLegacyUrl) return fromLegacyUrl;
  }
  return slugify(row.title);
};

const getExternalUrl = (row) => {
  const legacyUrl = String(row.url || '').trim();
  return isAbsoluteHttpUrl(legacyUrl) ? legacyUrl : '';
};

const loadRows = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('activities.json must contain an array');
  return parsed;
};

const validateRow = (row) => {
  const errors = [];
  if (!String(row.title || '').trim()) errors.push('Missing title');
  if (!normalizeDateOnly(row.date)) errors.push('Invalid or missing date');
  if (!String(row.image || '').trim()) errors.push('Missing image');
  if (!String(row.description || '').trim()) errors.push('Missing description');
  if (!getPreferredSlug(row)) errors.push('Unable to generate slug');
  return errors;
};

const chooseSlug = async ({ row, plannedSlugs }) => {
  const preferredSlug = getPreferredSlug(row);
  const byTitle = await Activities.findOne({
    where: {
      title: String(row.title || '').trim(),
    },
  });

  if (sameActivity(byTitle, row)) {
    return { slug: byTitle.url, existing: byTitle, action: 'skip_existing_title' };
  }

  const existingPreferred = await Activities.findOne({ where: { url: preferredSlug } });
  if (sameActivity(existingPreferred, row)) {
    return { slug: preferredSlug, existing: existingPreferred, action: 'skip_existing_slug' };
  }

  if (!existingPreferred && !plannedSlugs.has(preferredSlug)) {
    plannedSlugs.add(preferredSlug);
    return { slug: preferredSlug, existing: null, action: 'create' };
  }

  const fallbackBase = slugify(`${preferredSlug}-${row.id}`);
  let fallback = fallbackBase;
  let counter = 2;
  while (plannedSlugs.has(fallback) || await Activities.findOne({ where: { url: fallback } })) {
    const existingFallback = await Activities.findOne({ where: { url: fallback } });
    if (sameActivity(existingFallback, row)) {
      return { slug: fallback, existing: existingFallback, action: 'skip_existing_slug' };
    }
    fallback = `${fallbackBase}-${counter}`;
    counter += 1;
  }

  plannedSlugs.add(fallback);
  return {
    slug: fallback,
    existing: null,
    action: 'create',
    warning: `Slug collision for "${preferredSlug}", using "${fallback}"`,
  };
};

const buildActivityPayload = ({ row, slug, description, image }) => {
  const dateOnly = normalizeDateOnly(row.date);
  return {
    title: String(row.title || '').trim(),
    date: dateForDatabase(dateOnly),
    image,
    description,
    url: slug,
    status: 'published',
    contributors: ['IOM-ITB'],
    createdAt: row.createdAt ? new Date(String(row.createdAt).replace(' ', 'T')) : new Date(),
    updatedAt: row.updatedAt ? new Date(String(row.updatedAt).replace(' ', 'T')) : new Date(),
  };
};

const writeReport = (reportPath, report) => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const rows = loadRows(args.file);
  const report = {
    mode: args.dryRun ? 'dry-run' : 'apply',
    file: args.file,
    baseUrl: args.baseUrl,
    generatedAt: new Date().toISOString(),
    totals: {
      rows: rows.length,
      create: 0,
      skip: 0,
      update: 0,
      error: 0,
      mirroredImages: 0,
      reusedImages: 0,
      externalLinksAppended: 0,
      warnings: 0,
    },
    items: [],
  };

  const plannedSlugs = new Set();
  let hadValidationError = false;

  for (const row of rows) {
    const item = {
      legacyId: row.id,
      title: row.title,
      action: null,
      slug: null,
      originalImage: row.image,
      finalImage: row.image,
      imageMirrored: false,
      imageReused: false,
      externalUrlAppended: false,
      warnings: [],
      errors: [],
    };

    try {
      const rowErrors = validateRow(row);
      if (rowErrors.length > 0) {
        item.action = 'error';
        item.errors.push(...rowErrors);
        report.totals.error += 1;
        hadValidationError = true;
        report.items.push(item);
        continue;
      }

      const externalUrl = getExternalUrl(row);
      const { slug, existing, action, warning } = await chooseSlug({ row, plannedSlugs });
      item.slug = slug;
      if (warning) item.warnings.push(warning);

      if (externalUrl) {
        item.externalUrlAppended = true;
        report.totals.externalLinksAppended += 1;
      }

      if (action.startsWith('skip') && !args.forceUpdate) {
        item.action = action;
        report.totals.skip += 1;
        report.items.push(item);
        continue;
      }

      const description = buildDescriptionHtml(row.description, externalUrl);
      let imageResult = {
        finalUrl: row.image,
        mirrored: false,
        reused: false,
        warning: null,
      };

      if (args.apply) {
        imageResult = await mirrorImage({
          legacyId: row.id,
          imageUrl: row.image,
          baseUrl: args.baseUrl,
        });
      } else if (shouldMirrorImage(row.image)) {
        imageResult = {
          finalUrl: `${args.baseUrl || '<base-url>'}/uploads/legacy-activity-${row.id}-<hash>${path.extname(new URL(row.image).pathname) || '.jpg'}`,
          mirrored: true,
          reused: false,
          warning: null,
        };
      }

      item.finalImage = imageResult.finalUrl;
      item.imageMirrored = imageResult.mirrored;
      item.imageReused = imageResult.reused;
      if (imageResult.warning) item.warnings.push(`Image mirror failed; using original URL. ${imageResult.warning}`);
      if (item.imageMirrored) report.totals.mirroredImages += 1;
      if (item.imageReused) report.totals.reusedImages += 1;

      if (args.apply) {
        const payload = buildActivityPayload({
          row,
          slug,
          description,
          image: imageResult.finalUrl,
        });

        await sequelize.transaction(async (transaction) => {
          if (existing && args.forceUpdate) {
            await existing.update(payload, { transaction });
            item.action = 'update';
            report.totals.update += 1;
          } else {
            await Activities.create(payload, { transaction });
            item.action = 'create';
            report.totals.create += 1;
          }
        });
      } else {
        item.action = existing && args.forceUpdate ? 'would_update' : 'would_create';
        report.totals.create += existing && args.forceUpdate ? 0 : 1;
        report.totals.update += existing && args.forceUpdate ? 1 : 0;
      }

      if (item.warnings.length > 0) report.totals.warnings += item.warnings.length;
      report.items.push(item);
    } catch (error) {
      item.action = 'error';
      item.errors.push(error.message);
      report.totals.error += 1;
      hadValidationError = true;
      report.items.push(item);
    }
  }

  writeReport(args.report, report);

  console.log(`Mode: ${report.mode}`);
  console.log(`Rows: ${report.totals.rows}`);
  console.log(`Create: ${report.totals.create}`);
  console.log(`Update: ${report.totals.update}`);
  console.log(`Skip: ${report.totals.skip}`);
  console.log(`Errors: ${report.totals.error}`);
  console.log(`Mirrored images: ${report.totals.mirroredImages}`);
  console.log(`External links appended: ${report.totals.externalLinksAppended}`);
  console.log(`Report: ${args.report}`);

  if (hadValidationError) {
    process.exitCode = 1;
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close().catch(() => {});
  });
