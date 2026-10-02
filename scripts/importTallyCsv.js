#!/usr/bin/env node

/**
 * Mengisi TallySubmissions dari CSV export Tally — untuk submission yang
 * terlewat karena webhook belum terpasang, dan untuk memperbaiki baris
 * seed April yang kehilangan jawaban pada kolom berlabel ganda.
 *
 * Pemakaian (satu form per pemanggilan):
 *   node scripts/importTallyCsv.js --form=donasi --file=/tmp/Form_Donasi.csv --dry-run
 *   node scripts/importTallyCsv.js --form=donasi --file=/tmp/Form_Donasi.csv --apply
 *
 * Form: pendaftaran_anggota | pengajuan_bantuan | orang_tua_asuh | donasi
 *
 * Sifat:
 * - Aman dijalankan berulang: dedupe pada (formSlug, tallySubmissionId).
 * - Baris yang masuk lewat webhook TIDAK ditimpa (payload webhook lebih lengkap).
 * - Tidak mengirim WhatsApp/email apa pun.
 * - Pengajuan Bantuan baru diberi status TIDAK_DIKETAHUI, karena bisa saja
 *   sudah diproses lewat jalur lama (Google Sheet).
 * - Output hanya jumlah dan tanggal, tanpa data pribadi.
 */

const fs = require('fs');

const { TallySubmissions, sequelize } = require('../src/models');
const { FORM_SLUGS, parseTallyCsv } = require('./lib/tallyCsv');

sequelize.options.logging = false;

const BATCH_SIZE = 200;

const parseArgs = (argv) => {
  const args = { form: null, file: null, dryRun: false, apply: false };

  argv.forEach((arg) => {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--form=')) args.form = arg.slice('--form='.length);
    else if (arg.startsWith('--file=')) args.file = arg.slice('--file='.length);
  });

  if (args.dryRun === args.apply) throw new Error('Pakai tepat satu mode: --dry-run atau --apply');
  if (!FORM_SLUGS.includes(args.form)) throw new Error(`--form wajib salah satu dari: ${FORM_SLUGS.join(', ')}`);
  if (!args.file || !fs.existsSync(args.file)) throw new Error(`--file tidak ditemukan: ${args.file}`);
  return args;
};

const fmt = (date) => (date ? date.toISOString().replace('T', ' ').slice(0, 16) : '-');

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const { rows, skipped } = parseTallyCsv(fs.readFileSync(args.file, 'utf8'), args.form);

  const existing = await TallySubmissions.findAll({
    where: { formSlug: args.form },
    attributes: ['tallySubmissionId', 'sourceType'],
    raw: true,
  });
  const sourceById = new Map(existing.map((r) => [r.tallySubmissionId, r.sourceType]));

  const toInsert = rows.filter((r) => !sourceById.has(r.tallySubmissionId));
  const toRepair = rows.filter((r) => sourceById.get(r.tallySubmissionId) === 'csv_seed');
  const keptWebhook = rows.filter((r) => sourceById.get(r.tallySubmissionId) === 'webhook');
  const dates = rows.map((r) => r.submittedAt).sort((a, b) => a - b);

  console.log(`Form           : ${args.form} (${args.dryRun ? 'DRY RUN — tidak ada yang ditulis' : 'APPLY'})`);
  console.log(`Baris CSV      : ${rows.length} (rentang ${fmt(dates[0])} s/d ${fmt(dates[dates.length - 1])} UTC)`);
  console.log(`Dilewati       : ${skipped.length}${skipped.length ? ` — ${JSON.stringify(skipped.slice(0, 5))}` : ''}`);
  console.log(`Sudah di DB    : ${existing.length}`);
  console.log(`  baru         : ${toInsert.length}`);
  console.log(`  diperbarui   : ${toRepair.length} (asal csv_seed)`);
  console.log(`  dibiarkan    : ${keptWebhook.length} (asal webhook)`);

  if (args.dryRun) return;

  const now = new Date();
  const writable = [...toInsert, ...toRepair].map((r) => ({
    ...r,
    sourceType: 'csv_seed',
    createdAt: now,
    updatedAt: now,
  }));

  await sequelize.transaction(async (transaction) => {
    for (let i = 0; i < writable.length; i += BATCH_SIZE) {
      await TallySubmissions.bulkCreate(writable.slice(i, i + BATCH_SIZE), {
        updateOnDuplicate: ['respondentId', 'formId', 'submittedAt', 'payload', 'extractedWhatsapp', 'updatedAt'],
        transaction,
      });
    }

    if (args.form === 'pengajuan_bantuan') {
      await sequelize.query(
        `INSERT INTO PengajuanBantuanStatuses (submissionId, currentStatus, catatan, updatedBy, createdAt, updatedAt)
         SELECT ts.id, 'TIDAK_DIKETAHUI', NULL, 'IMPORT_CSV', NOW(), NOW()
         FROM TallySubmissions ts
         WHERE ts.formSlug = 'pengajuan_bantuan'
           AND NOT EXISTS (SELECT 1 FROM PengajuanBantuanStatuses pbs WHERE pbs.submissionId = ts.id)`,
        { transaction },
      );
      await sequelize.query(
        `INSERT INTO PengajuanBantuanStatusHistories
           (submissionId, oldStatus, newStatus, oldCatatan, newCatatan, changedBy, changedAt, createdAt, updatedAt)
         SELECT pbs.submissionId, NULL, pbs.currentStatus, NULL, pbs.catatan, 'IMPORT_CSV', NOW(), NOW(), NOW()
         FROM PengajuanBantuanStatuses pbs
         WHERE NOT EXISTS (SELECT 1 FROM PengajuanBantuanStatusHistories h WHERE h.submissionId = pbs.submissionId)`,
        { transaction },
      );
    }
  });

  const total = await TallySubmissions.count({ where: { formSlug: args.form } });
  console.log(`Selesai. Total ${args.form} di DB sekarang: ${total}`);
};

main()
  .then(() => sequelize.close())
  .catch(async (error) => {
    console.error(error.message || error);
    await sequelize.close();
    process.exit(1);
  });
