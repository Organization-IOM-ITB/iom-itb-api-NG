'use strict';

// Form Tally DONASI (mZJe8e) — satu-satunya jalur donasi di www-NG selama
// pembayaran otomatis (Midtrans) dinonaktifkan — sebelumnya tidak punya
// tempat di DB NG. formSlug adalah ENUM di dua tabel, jadi keduanya diperluas.

const TABLES = ['TallySubmissions', 'TallyWebhookEvents'];
const BASE_SLUGS = ['pendaftaran_anggota', 'pengajuan_bantuan', 'orang_tua_asuh'];

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      await queryInterface.changeColumn(table, 'formSlug', {
        type: Sequelize.ENUM(...BASE_SLUGS, 'donasi'),
        allowNull: false,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // ENUM tidak bisa dipersempit selama masih ada baris 'donasi'.
    for (const table of TABLES) {
      await queryInterface.bulkDelete(table, { formSlug: 'donasi' });
      await queryInterface.changeColumn(table, 'formSlug', {
        type: Sequelize.ENUM(...BASE_SLUGS),
        allowNull: false,
      });
    }
  },
};
