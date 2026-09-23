#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');

const { Activities, sequelize } = require('../src/models');
// Daftar host stack lama + logika unduh/mirror dipakai bersama dengan
// scripts/rehostActivityImages.js — satu sumber kebenaran, karena v1 & v2
// akan dihentikan dan tidak boleh ada URL tersisa ke sana.
const { isLegacyImageUrl, mirrorImage } = require('./lib/legacyImages');

sequelize.options.logging = false;

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
          prefix: `legacy-activity-${row.id}`,
          imageUrl: row.image,
          baseUrl: args.baseUrl,
        });
      } else if (isLegacyImageUrl(row.image)) {
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
