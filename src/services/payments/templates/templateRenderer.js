const { EmailTemplate } = require('../../../models');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const replaceVariables = (template, data) => {
  return String(template || '').replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    return escapeHtml(data[key] ?? '');
  });
};

const textToHtml = (text) => {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim()
      ? `<p style="margin:0 0 12px;">${line}</p>`
      : '<br />'
    )
    .join('');
};

/**
 * Membuang baris yang isinya HANYA satu placeholder opsional yang bernilai
 * kosong — mis. baris `{{notesBlock}}` ketika pembeli tidak mengisi catatan.
 * Tanpa ini baris tersebut menyisakan baris kosong (satu <br /> liar) di
 * tengah email. Baris kosong yang memang ditulis di template tidak tersentuh.
 */
const dropEmptyPlaceholderLines = (template, data) => String(template || '')
  .split('\n')
  .filter((line) => {
    const m = line.trim().match(/^{{\s*(\w+)\s*}}$/);
    if (!m) return true;
    const v = data[m[1]];
    return !(v === undefined || v === null || String(v) === '');
  })
  .join('\n');

const getRenderedEmailTemplate = async (key, data, fallback) => {
  const template = await EmailTemplate.findOne({
    where: { key, isActive: true },
  });

  const subject = template?.subject || fallback.subject;
  const body = dropEmptyPlaceholderLines(template?.body || fallback.body, data);

  return {
    subject: replaceVariables(subject, data),
    bodyHtml: textToHtml(replaceVariables(body, data)),
  };
};

module.exports = {
  getRenderedEmailTemplate,
  replaceVariables,
  dropEmptyPlaceholderLines,
};