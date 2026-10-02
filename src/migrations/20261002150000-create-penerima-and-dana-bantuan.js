'use strict';

// Model Penerima & DanaBantuan (beserta route /dana-bantuan) sudah ada di NG,
// tetapi tabelnya tidak pernah dibuat: di v1 kedua tabel dibuat manual di luar
// migration, jadi tidak ada migration yang bisa ikut terbawa. Akibatnya
// halaman Dana Bantuan di admin-NG selalu gagal memuat data.
//
// Struktur meniru `SHOW CREATE TABLE` v1 (database `iom-itb`) supaya data
// v1 bisa dipindah apa adanya. Satu tambahan: foreign key sungguhan dari
// DanaBantuan.id_penerima — v1 hanya punya index. Aman karena v1 tidak punya
// baris yatim, dan deleteDanaBantuan menghapus dana sebelum penerimanya.
//
// Donations.proof diperlebar 255 → 1000 seperti di v1, agar URL bukti v1
// yang panjang tidak ditolak saat dipindah.

const TABLE_OPTIONS = { charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' };

const tableExists = async (queryInterface, table) => {
  const [rows] = await queryInterface.sequelize.query('SHOW TABLES LIKE :table', {
    replacements: { table },
  });
  return rows.length > 0;
};

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await tableExists(queryInterface, 'Penerima'))) {
      await queryInterface.createTable('Penerima', {
        id_penerima: {
          type: Sequelize.BIGINT.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        nama: { type: Sequelize.STRING(255), allowNull: false },
        nim: { type: Sequelize.STRING(50), allowNull: false },
        program_studi: { type: Sequelize.STRING(255), allowNull: false },
      }, TABLE_OPTIONS);
      await queryInterface.addIndex('Penerima', ['nim'], { name: 'penerima_nim_unique', unique: true });
    }

    if (!(await tableExists(queryInterface, 'DanaBantuan'))) {
      await queryInterface.createTable('DanaBantuan', {
        id_dana: {
          type: Sequelize.BIGINT.UNSIGNED,
          autoIncrement: true,
          primaryKey: true,
          allowNull: false,
        },
        id_penerima: {
          type: Sequelize.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: 'Penerima', key: 'id_penerima' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        jenis_bantuan: { type: Sequelize.STRING(255), allowNull: false },
        bulan: { type: Sequelize.STRING(50), allowNull: false },
        tahun: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 2008 },
        jumlah_donasi: { type: Sequelize.DECIMAL(15, 2), allowNull: false },
      }, TABLE_OPTIONS);
      await queryInterface.addIndex('DanaBantuan', ['id_penerima'], { name: 'dana_bantuan_id_penerima_foreign' });
    }

    await queryInterface.changeColumn('Donations', 'proof', {
      type: Sequelize.STRING(1000),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    // Tidak menyempitkan Donations.proof kembali: baris dengan URL > 255
    // karakter akan terpotong atau ditolak.
    await queryInterface.dropTable('DanaBantuan');
    await queryInterface.dropTable('Penerima');
  },
};
