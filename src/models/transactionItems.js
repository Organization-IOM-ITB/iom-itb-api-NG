'use strict';
const { Model } = require('sequelize');
const { parseStored } = require('../utils/merchandiseOptions');

// Satu baris produk dalam pesanan (keranjang). Lihat
// migrations/20261021090000-create-transaction-items.js.
module.exports = (sequelize, DataTypes) => {
  class TransactionItems extends Model {
    static associate(models) {
      this.belongsTo(models.Transactions, {
        foreignKey: 'transactionId',
        as: 'transaction'
      });
      this.belongsTo(models.Merchandises, {
        foreignKey: 'merchandiseId',
        as: 'merchandise'
      });
    }
  }

  TransactionItems.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    transactionId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    merchandiseId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    merchandiseName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // Harga satuan saat pesan, sudah termasuk tambahan harga opsi.
    unitPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    qty: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    // Snapshot pilihan opsi pembeli: [{ name, value, extraPrice }].
    selectedOptions: {
      type: DataTypes.JSON,
      allowNull: true,
      get() {
        return parseStored(this.getDataValue('selectedOptions')) || null;
      }
    }
  }, {
    sequelize,
    modelName: 'TransactionItems',
    tableName: 'TransactionItems',
  });

  return TransactionItems;
};
