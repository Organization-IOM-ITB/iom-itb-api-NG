'use strict';

/**
 * Menyisipkan baris "Catatan" ke template notifikasi transaksi yang sudah
 * terlanjur ada di tabel EmailTemplates (hasil seeder lama).
 *
 * Template ini bisa diedit admin lewat halaman Template Pesan, jadi migrasi
 * ini SENGAJA hanya menyentuh baris yang isinya masih persis sama dengan
 * hasil seeder. Kalau admin sudah pernah mengubahnya, baris itu dilewati —
 * lebih baik admin menambahkan sendiri `{{notesBlock}}` / `{{notes_block}}`
 * daripada kustomisasinya tertimpa diam-diam.
 */

const TARGETS = [
  {
    key: 'transaction_payment_confirmation',
    find: 'Produk: {{merchandiseName}} x {{qty}}\nTotal: Rp {{amount}}',
    replace: 'Produk: {{merchandiseName}} x {{qty}}\n{{notesBlock}}\nTotal: Rp {{amount}}',
  },
  {
    key: 'transaction_payment_whatsapp',
    find: 'Produk: {{merchandise_name}} x {{qty}}\nTotal: Rp {{amount}}',
    replace: 'Produk: {{merchandise_name}} x {{qty}}\n{{notes_block}}\nTotal: Rp {{amount}}',
  },
];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const t of TARGETS) {
      const [rows] = await queryInterface.sequelize.query(
        'SELECT id, body FROM `EmailTemplates` WHERE `key` = ?',
        { replacements: [t.key] }
      );
      for (const row of rows) {
        if (!row.body || !row.body.includes(t.find)) {
          console.log(`[skip] ${t.key} sudah dikustomisasi admin — tambahkan variabel catatan secara manual`);
          continue;
        }
        await queryInterface.sequelize.query(
          'UPDATE `EmailTemplates` SET `body` = ?, `updatedAt` = NOW() WHERE `id` = ?',
          { replacements: [row.body.replace(t.find, t.replace), row.id] }
        );
        console.log(`[ok] ${t.key} diperbarui`);
      }
    }
  },

  async down(queryInterface, Sequelize) {
    for (const t of TARGETS) {
      const [rows] = await queryInterface.sequelize.query(
        'SELECT id, body FROM `EmailTemplates` WHERE `key` = ?',
        { replacements: [t.key] }
      );
      for (const row of rows) {
        if (!row.body || !row.body.includes(t.replace)) continue;
        await queryInterface.sequelize.query(
          'UPDATE `EmailTemplates` SET `body` = ?, `updatedAt` = NOW() WHERE `id` = ?',
          { replacements: [row.body.replace(t.replace, t.find), row.id] }
        );
      }
    }
  },
};
