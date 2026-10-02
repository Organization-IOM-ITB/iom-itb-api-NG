'use strict';

/**
 * Membaca CSV export Tally menjadi baris siap-simpan TallySubmissions.
 * Dipisah dari scripts/importTallyCsv.js agar bisa diuji tanpa database.
 */

const { parse } = require('csv-parse/sync');
const { buildCsvNormalized } = require('../../src/utils/tallyPayloadNormalizer');

const FORM_SLUGS = ['pendaftaran_anggota', 'pengajuan_bantuan', 'orang_tua_asuh', 'donasi'];

const pickCsvValue = (row, aliases) => {
  for (const alias of aliases) {
    const key = Object.keys(row || {}).find(
      (k) => k.trim().toLowerCase() === String(alias).trim().toLowerCase(),
    );
    if (key === undefined) continue;
    const cell = Array.isArray(row[key]) ? row[key].find((v) => String(v ?? '').trim()) : row[key];
    if (cell !== undefined && cell !== null && String(cell).trim() !== '') return String(cell).trim();
  }
  return null;
};

// Tally mengekspor "Submitted at" sebagai "YYYY-MM-DD HH:mm:ss" dalam UTC.
const parseSubmittedAt = (rawValue) => {
  if (!rawValue) return null;
  const s = String(rawValue).trim();
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(s)) return new Date(`${s.replace(' ', 'T')}Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const parseTallyCsv = (content, formSlug) => {
  if (!FORM_SLUGS.includes(formSlug)) {
    throw new Error(`formSlug tidak dikenal: ${formSlug} (pilihan: ${FORM_SLUGS.join(', ')})`);
  }

  // group_columns_by_name: kolom berjudul sama (pertanyaan kondisional
  // berlabel sama) menjadi array, bukan saling menimpa — tanpa ini nilai
  // kolom TERAKHIR yang menang meskipun kosong.
  const records = parse(content, {
    columns: true,
    group_columns_by_name: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: false,
  });

  const rows = [];
  const skipped = [];

  records.forEach((record, index) => {
    const tallySubmissionId = pickCsvValue(record, ['Submission ID', 'submissionid']);
    const submittedAt = parseSubmittedAt(pickCsvValue(record, ['Submitted at']));

    // Tanpa Submission ID baris tidak bisa di-dedupe terhadap webhook, dan
    // tanpa tanggal ia akan tercatat sebagai submission "hari ini".
    if (!tallySubmissionId || !submittedAt) {
      skipped.push({ line: index + 2, reason: !tallySubmissionId ? 'tanpa Submission ID' : 'tanggal tidak terbaca' });
      return;
    }

    const { payload, extractedWhatsapp } = buildCsvNormalized(record, formSlug);
    rows.push({
      tallySubmissionId,
      respondentId: pickCsvValue(record, ['Respondent ID']),
      formId: pickCsvValue(record, ['Form ID']),
      formSlug,
      submittedAt,
      payload,
      extractedWhatsapp,
    });
  });

  return { rows, skipped };
};

module.exports = { FORM_SLUGS, parseTallyCsv, parseSubmittedAt };
