'use strict';

// Ongkir live (RajaOngkir / AgenWebsite): sumber tarif, layanan kurir, dan
// kode pos tujuan. Transaksi lama / tarif tabel zona: shippingProvider
// 'table' atau NULL.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Transactions', 'shippingProvider', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
    await queryInterface.addColumn('Transactions', 'shippingService', {
      type: Sequelize.STRING(128),
      allowNull: true,
    });
    await queryInterface.addColumn('Transactions', 'shippingPostalCode', {
      type: Sequelize.STRING(10),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Transactions', 'shippingPostalCode');
    await queryInterface.removeColumn('Transactions', 'shippingService');
    await queryInterface.removeColumn('Transactions', 'shippingProvider');
  },
};
