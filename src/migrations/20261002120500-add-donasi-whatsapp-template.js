'use strict';

// Template WA konfirmasi untuk form Tally DONASI, agar bisa diedit di menu
// Template Pesan seperti tiga form lainnya (seeder 20260510100001).
// Dijadikan migration, bukan seeder, supaya ikut jalan di deploy berikutnya.

const KEY = 'donasi_form_whatsapp';

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query(
      'SELECT id FROM EmailTemplates WHERE `key` = :key LIMIT 1',
      { replacements: { key: KEY } },
    );
    if (existing.length) return;

    const now = new Date();
    await queryInterface.bulkInsert('EmailTemplates', [
      {
        key: KEY,
        title: 'Donasi - Konfirmasi Penerimaan Form',
        subject: null,
        // Tidak menyebut dana "sudah diterima": transfer belum diverifikasi bendahara.
        body: 'Halo {{name}}, terima kasih. Konfirmasi donasi Anda sudah kami terima dan akan dicek oleh Bendahara IOM-ITB. Ref: {{submission_id}}.',
        variables: JSON.stringify(['name', 'submission_id']),
        channel: 'whatsapp',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('EmailTemplates', { key: KEY });
  },
};
