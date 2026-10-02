'use strict';

const CHOICE_TYPES = new Set(['MULTIPLE_CHOICE', 'DROPDOWN', 'CHECKBOXES']);
const FILE_UPLOAD_TYPE = 'FILE_UPLOAD';

// Tally CSV exports these as header columns, not actual form answers.
const CSV_METADATA_LABELS = new Set([
  'Submission ID',
  'submission id',
  'Respondent ID',
  'respondent id',
  'Form ID',
  'form id',
  'Submitted at',
  'submitted at',
  'Start Date (UTC)',
  'End Date (UTC)',
  'Network ID',
  'Location',
]);

function normalizeTextForMatching(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPhoneLikeLabel(input) {
  const n = normalizeTextForMatching(input);
  return (
    n.includes('nomor wa') ||
    n.includes('no wa') ||
    n.includes('no hp') ||
    n.includes('whatsapp') ||
    n.includes('nomor hp') ||
    n.includes('phone number') ||
    n === 'phone' ||
    n.includes(' phone ')
  );
}

// Resolves option IDs to human-readable text and joins multiple selections.
// Returns a plain string or null — never an array.
function resolveChoiceValue(field) {
  const options = Array.isArray(field?.options) ? field.options : [];
  const rawValue = field?.value;

  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (!options.length) {
    // No option map available — fall back to raw value as string.
    if (Array.isArray(rawValue)) {
      const texts = rawValue.map(String).filter(Boolean);
      return texts.length ? texts.join(', ') : null;
    }
    const s = String(rawValue).trim();
    return s || null;
  }

  const optionMap = new Map(options.map((o) => [String(o.id), String(o.text || '')]));
  const ids = Array.isArray(rawValue) ? rawValue : [rawValue];
  const texts = ids.map((id) => optionMap.get(String(id)) || String(id)).filter(Boolean);
  return texts.length ? texts.join(', ') : null;
}

// Tally emits a derived per-option field for every CHECKBOXES option:
//   parent: { key: "question_abc", type: "CHECKBOXES", options: [...], value: [id,...] | null }
//   derived: { key: "question_abc_<optionId>", type: "CHECKBOXES", value: true | null }
// Derived fields have no options array. Skip them — the parent already carries the selection.
function isDerivedCheckboxField(field) {
  return (
    String(field?.type || '').toUpperCase() === 'CHECKBOXES' && !Array.isArray(field?.options)
  );
}

// Tally CSV exports a separate boolean column for each checkbox option:
//   "Question label (Option text)" → "true" / "false"
// Detect by: boolean-like value AND label ends with "(SomeText)".
function isCsvDerivedColumn(label, rawValue) {
  const v = String(rawValue ?? '').trim().toLowerCase();
  return (v === 'true' || v === 'false') && /\(.+\)\s*$/.test(String(label).trim());
}

const isEmptyAnswer = (value) =>
  value === null || value === undefined || String(value).trim() === '';

// Satu form Tally bisa punya beberapa pertanyaan berlabel sama — biasanya
// varian kondisional yang hanya satu terisi (mis. "Nama" di Pengajuan
// Bantuan, "Upload Bukti Bayar" ×3 di Donasi). Jawaban kosong tidak boleh
// menimpa jawaban yang sudah terisi; dua jawaban terisi yang berbeda
// keduanya disimpan, yang berikutnya sebagai "Label (2)", "Label (3)", ...
function assignAnswer(answersByLabel, label, value) {
  if (!(label in answersByLabel)) {
    answersByLabel[label] = value;
    return;
  }

  if (isEmptyAnswer(value)) return;

  if (isEmptyAnswer(answersByLabel[label])) {
    answersByLabel[label] = value;
    return;
  }

  if (answersByLabel[label] === value) return;

  let n = 2;
  while (`${label} (${n})` in answersByLabel) n += 1;
  answersByLabel[`${label} (${n})`] = value;
}

/**
 * Normalize a Tally webhook payload.
 * Returns { payload, extractedWhatsapp }.
 */
function buildWebhookNormalized(rawPayload, formSlug) {
  const data = rawPayload?.data || rawPayload?.event?.data || {};
  const fields = Array.isArray(data?.fields) ? data.fields : [];

  const answersByLabel = {};
  let extractedWhatsapp = null;

  for (const field of fields) {
    if (isDerivedCheckboxField(field)) continue;

    // Use label first; fall back to key when label is null/empty (Tally quirk).
    const label = String(field?.label ?? field?.key ?? '').trim();
    const effectiveLabel = label || String(field?.key ?? '').trim();
    if (!effectiveLabel) continue;

    const type = String(field?.type || '').toUpperCase();
    let value;

    if (CHOICE_TYPES.has(type)) {
      value = resolveChoiceValue(field);
    } else if (type === FILE_UPLOAD_TYPE) {
      const raw = field?.value;
      if (!Array.isArray(raw) || raw.length === 0) {
        value = null;
      } else {
        const urls = raw.map((f) => f?.url).filter(Boolean);
        value = urls.length ? urls.join(', ') : null;
      }
    } else {
      const raw = field?.value;
      if (raw === null || raw === undefined) {
        value = null;
      } else {
        const s = String(raw).trim();
        value = s || null;
      }
    }

    assignAnswer(answersByLabel, effectiveLabel, value);

    if (!extractedWhatsapp && value) {
      if (type === 'INPUT_PHONE_NUMBER' || isPhoneLikeLabel(effectiveLabel)) {
        extractedWhatsapp = value;
      }
    }
  }

  return {
    payload: {
      source: 'webhook',
      formSlug: formSlug || null,
      submissionId: data?.submissionId || data?.responseId || null,
      respondentId: data?.respondentId || null,
      formId: data?.formId || null,
      submittedAt: data?.createdAt || rawPayload?.createdAt || null,
      answersByLabel,
    },
    extractedWhatsapp,
  };
}

/**
 * Normalize a Tally CSV export row.
 * Returns { payload, extractedWhatsapp }.
 */
function buildCsvNormalized(row, formSlug) {
  const answersByLabel = {};
  let extractedWhatsapp = null;

  for (const [label, rawCell] of Object.entries(row || {})) {
    const labelText = String(label ?? '').trim();
    if (!labelText) continue;
    if (CSV_METADATA_LABELS.has(labelText)) continue;

    // Kolom berjudul sama datang sebagai array bila CSV di-parse dengan
    // `group_columns_by_name: true` (lihat scripts/importTallyCsv.js).
    const cells = Array.isArray(rawCell) ? rawCell : [rawCell];

    for (const rawValue of cells) {
      const trimmed = (rawValue === null || rawValue === undefined ? '' : String(rawValue)).trim();
      if (!trimmed) continue;

      if (isCsvDerivedColumn(labelText, trimmed)) continue;

      assignAnswer(answersByLabel, labelText, trimmed);

      if (!extractedWhatsapp && isPhoneLikeLabel(labelText)) {
        extractedWhatsapp = trimmed;
      }
    }
  }

  return {
    payload: {
      source: 'csv_seed',
      formSlug,
      submissionId: row?.['Submission ID'] || row?.['submission id'] || null,
      respondentId: row?.['Respondent ID'] || row?.['respondent id'] || null,
      formId: row?.['Form ID'] || row?.['form id'] || null,
      submittedAt: row?.['Submitted at'] || row?.['submitted at'] || null,
      answersByLabel,
    },
    extractedWhatsapp,
  };
}

module.exports = {
  buildWebhookNormalized,
  buildCsvNormalized,
  isPhoneLikeLabel,
};
