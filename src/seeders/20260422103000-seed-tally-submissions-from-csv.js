'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { buildCsvNormalized } = require('../utils/tallyPayloadNormalizer');

const FORM_CONFIGS = [
  { fileName: 'Form_Pendaftaran_Anggota.csv', formSlug: 'pendaftaran_anggota' },
  { fileName: 'Form_Pengajuan_Bantuan.csv', formSlug: 'pengajuan_bantuan' },
  { fileName: 'Form_Orang_Tua_Asuh.csv', formSlug: 'orang_tua_asuh' },
];

function pickCsvValue(row, aliases) {
  for (const alias of aliases) {
    const key = Object.keys(row || {}).find(
      (k) => k.trim().toLowerCase() === String(alias).trim().toLowerCase(),
    );
    if (key !== undefined) {
      const v = row[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return null;
}

function parseSubmittedAt(rawValue) {
  if (!rawValue) return null;
  const s = String(rawValue).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveSubmissionId(row, fallbackSeed) {
  const direct = pickCsvValue(row, ['Submission ID', 'submission id', 'submissionid']);
  if (direct) return direct;
  return crypto.createHash('sha256').update(fallbackSeed).digest('hex').slice(0, 40);
}

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();
    const csvDir = process.env.SEED_CSV_DIR || __dirname;
    const submissionRows = [];

    for (const config of FORM_CONFIGS) {
      const filePath = path.join(csvDir, config.fileName);

      if (!fs.existsSync(filePath)) {
        throw new Error(
          `CSV file not found: ${filePath}. Set SEED_CSV_DIR to your CSV directory before running seed.`,
        );
      }

      const records = parse(fs.readFileSync(filePath, 'utf8'), {
        columns: true,
        // Kolom berjudul sama → array (lihat buildCsvNormalized); tanpa ini
        // kolom terakhir menang meskipun kosong.
        group_columns_by_name: true,
        skip_empty_lines: true,
        bom: true,
        relax_quotes: true,
        relax_column_count: true,
        trim: false,
      });

      for (const [index, row] of records.entries()) {
        const tallySubmissionId = resolveSubmissionId(
          row,
          `${config.formSlug}:${config.fileName}:${index}:${JSON.stringify(row)}`,
        );

        const respondentId = pickCsvValue(row, ['Respondent ID', 'respondent id']);
        const formId = pickCsvValue(row, ['Form ID', 'form id']);
        const submittedAt = parseSubmittedAt(pickCsvValue(row, ['Submitted at', 'submitted at'])) || now;

        const { payload, extractedWhatsapp } = buildCsvNormalized(row, config.formSlug);

        submissionRows.push({
          tallySubmissionId,
          respondentId,
          formId,
          formSlug: config.formSlug,
          submittedAt,
          payload: JSON.stringify(payload),
          extractedWhatsapp,
          sourceType: 'csv_seed',
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (!submissionRows.length) return;

    await queryInterface.bulkInsert('TallySubmissions', submissionRows, {
      updateOnDuplicate: ['respondentId', 'formId', 'submittedAt', 'payload', 'extractedWhatsapp', 'updatedAt'],
    });

    await queryInterface.sequelize.query(`
      INSERT INTO PengajuanBantuanStatuses
        (submissionId, currentStatus, catatan, updatedBy, createdAt, updatedAt)
      SELECT ts.id, 'TIDAK_DIKETAHUI', NULL, 'SEEDER', NOW(), NOW()
      FROM TallySubmissions ts
      WHERE ts.formSlug = 'pengajuan_bantuan'
      AND NOT EXISTS (SELECT 1 FROM PengajuanBantuanStatuses pbs WHERE pbs.submissionId = ts.id)
    `);

    await queryInterface.sequelize.query(`
      INSERT INTO PengajuanBantuanStatusHistories
        (submissionId, oldStatus, newStatus, oldCatatan, newCatatan, changedBy, changedAt, createdAt, updatedAt)
      SELECT pbs.submissionId, NULL, pbs.currentStatus, NULL, pbs.catatan, 'SEEDER', NOW(), NOW(), NOW()
      FROM PengajuanBantuanStatuses pbs
      INNER JOIN TallySubmissions ts ON ts.id = pbs.submissionId
      WHERE ts.formSlug = 'pengajuan_bantuan'
        AND ts.sourceType = 'csv_seed'
        AND NOT EXISTS (SELECT 1 FROM PengajuanBantuanStatusHistories pbsh WHERE pbsh.submissionId = pbs.submissionId)
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(`DELETE ts FROM TallySubmissions ts WHERE ts.sourceType = 'csv_seed'`);
  },
};
