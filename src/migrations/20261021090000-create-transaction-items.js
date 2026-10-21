'use strict';

// Keranjang: satu transaksi (pesanan) bisa berisi beberapa produk.
// Transactions tetap menjadi header pesanan (pembeli, alamat, ongkir,
// grossAmount, status); baris produk pindah ke TransactionItems.
// Transaksi lama di-backfill jadi satu item agar semua pesanan punya item.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TransactionItems', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      transactionId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Transactions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      merchandiseId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Merchandises', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      // Snapshot saat pesan, agar riwayat tetap benar walau produk diubah/dihapus.
      merchandiseName: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      unitPrice: {
        type: Sequelize.DECIMAL(12, 2),
        allowNull: false,
      },
      qty: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      selectedOptions: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('TransactionItems', ['transactionId']);
    await queryInterface.addIndex('TransactionItems', ['merchandiseId']);

    // Harga satuan transaksi lama diturunkan dari grossAmount (harga saat itu),
    // bukan dari harga produk sekarang.
    await queryInterface.sequelize.query(`
      INSERT INTO TransactionItems
        (transactionId, merchandiseId, merchandiseName, unitPrice, qty, selectedOptions, createdAt, updatedAt)
      SELECT
        t.id,
        t.merchandiseId,
        COALESCE(m.name, CONCAT('Merchandise #', t.merchandiseId)),
        CASE
          WHEN t.grossAmount IS NOT NULL AND t.qty > 0
            THEN ROUND((t.grossAmount - COALESCE(t.shippingCost, 0)) / t.qty, 2)
          ELSE COALESCE(m.price, 0)
        END,
        t.qty,
        t.selectedOptions,
        t.createdAt,
        t.updatedAt
      FROM Transactions t
      LEFT JOIN Merchandises m ON m.id = t.merchandiseId
      WHERE NOT EXISTS (SELECT 1 FROM TransactionItems ti WHERE ti.transactionId = t.id)
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TransactionItems');
  },
};
