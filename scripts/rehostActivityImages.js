#!/usr/bin/env node

/**
 * Memindahkan gambar kegiatan yang masih menunjuk stack lama (v1 `upload00`,
 * v2 `iom-apiv2`) ke penyimpanan NG sendiri, lalu memperbarui kolom `image`.
 *
 * Latar: stack v1 dan v2 akan dihentikan. Selama baris Activities masih
 * memuat URL ke host tersebut, halaman Kegiatan akan kehilangan gambar
 * begitu stack lama dimatikan.
 *
 * Pemakaian:
 *   node scripts/rehostActivityImages.js --dry-run
 *   node scripts/rehostActivityImages.js --apply --base-url=https://api-ng.iom-itb.id
 *
 * Aman dijalankan berulang: nama berkas diturunkan dari hash URL asal, dan
 * baris yang sudah menunjuk NG akan dilewati.
 */

const fs = require('fs');
const path = require('path');

const { Activities, sequelize } = require('../src/models');
const { isLegacyImageUrl, mirrorImage } = require('./lib/legacyImages');

sequelize.options.logging = false;

const parseArgs = (argv) => {
  const args = {
    dryRun: false,
    apply: false,
    report: null,
    baseUrl: process.env.BASE_URL || process.env.API_BASE_URL || '',
  };

  argv.forEach((arg) => {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--report=')) args.report = arg.slice('--report='.length);
    else if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length);
  });

  if (args.dryRun === args.apply) {
    throw new Error('Use exactly one mode: --dry-run or --apply');
  }
  if (!args.baseUrl && args.apply) {
    throw new Error('Missing --base-url=https://api-ng.iom-itb.id for apply mode');
  }
  if (!args.report) {
    args.report = path.resolve(
      process.cwd(),
      args.dryRun ? 'migration-reports/rehost-images-dry-run.json' : 'migration-reports/rehost-images-apply.json'
    );
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, '');
  return args;
};

const writeReport = (reportPath, report) => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
};

const hostOf = (value) => {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return '(bukan URL absolut)';
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  const all = await Activities.findAll({ order: [['id', 'ASC']] });
  const affected = all.filter((row) => isLegacyImageUrl(row.image));

  const report = {
    mode: args.dryRun ? 'dry-run' : 'apply',
    baseUrl: args.baseUrl,
    generatedAt: new Date().toISOString(),
    totals: {
      activities: all.length,
      affected: affected.length,
      rehosted: 0,
      reused: 0,
      failed: 0,
      skipped: all.length - affected.length,
    },
    byHost: {},
    items: [],
  };

  for (const row of affected) {
    const host = hostOf(row.image);
    report.byHost[host] = (report.byHost[host] || 0) + 1;

    const item = {
      id: row.id,
      title: row.title,
      host,
      originalImage: row.image,
      finalImage: row.image,
      action: null,
      warning: null,
    };

    if (args.dryRun) {
      item.action = 'would_rehost';
      report.items.push(item);
      continue;
    }

    const result = await mirrorImage({
      prefix: `activity-${row.id}`,
      imageUrl: row.image,
      baseUrl: args.baseUrl,
    });

    if (!result.mirrored) {
      // Host mati / berkas hilang: baris SENGAJA tidak diubah supaya URL
      // aslinya tetap terlihat untuk penelusuran manual.
      item.action = 'failed';
      item.warning = result.warning;
      report.totals.failed += 1;
      report.items.push(item);
      continue;
    }

    await row.update({ image: result.finalUrl });
    item.finalImage = result.finalUrl;
    item.action = result.reused ? 'reused' : 'rehosted';
    if (result.reused) report.totals.reused += 1;
    else report.totals.rehosted += 1;
    report.items.push(item);
  }

  writeReport(args.report, report);

  console.log(`Mode           : ${report.mode}`);
  console.log(`Total kegiatan : ${report.totals.activities}`);
  console.log(`Masih host lama: ${report.totals.affected}`);
  console.log(`Per host       : ${JSON.stringify(report.byHost)}`);
  if (args.apply) {
    console.log(`Dipindah       : ${report.totals.rehosted}`);
    console.log(`Sudah ada      : ${report.totals.reused}`);
    console.log(`GAGAL          : ${report.totals.failed}`);
  }
  console.log(`Report         : ${args.report}`);

  if (report.totals.failed > 0) {
    console.log('\nGagal dipindah (berkas sumber sudah tidak ada, perlu unggah ulang manual):');
    report.items.filter((i) => i.action === 'failed')
      .forEach((i) => console.log(`  - [${i.id}] ${i.title} :: ${i.warning}`));
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
