'use strict';
const crypto = require('crypto');
const { Model, Op } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Donations extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Define any associations if needed in the future
    }

    /**
     * Fetch donations by donor's name keyword
     * @param {string} keyword - The name keyword to search for
     */
    static async getDonationsByName(keyword) {
      return this.findAll({
        where: {
          name: { [Op.like]: `%${keyword}%` }
        }
      });
    }
  }

  Donations.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    noWhatsapp: {
      type: DataTypes.STRING,
      allowNull: false
    },
    proof: {
      type: DataTypes.BLOB('medium'),
      allowNull: true
    },
    notification: {
      type: DataTypes.JSON,
      allowNull: false
    },
    amount: {
      type: DataTypes.FLOAT,  // Bisa menggunakan INTEGER jika jumlah donasi berupa bilangan bulat
      allowNull: true
    },
    options: {
      type: DataTypes.JSON,  // Menyimpan data tambahan dalam bentuk JSON
      allowNull: true
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true
    },
    bank: {
      type: DataTypes.STRING,
      allowNull: true
    },
    donationType: {
      type: DataTypes.ENUM(
        'iuran_sukarela',
        'kontribusi_anggota',
        'kontribusi_donatur',
        'pembelian_merchandise',
        'kontribusi_sukarela'
      ),
      allowNull: true
    },
    facultyId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'Faculties', key: 'id' }
    },
    kodeUnik: {
      type: DataTypes.STRING(3),
      allowNull: true
    },
    paymentMethod: {
      type: DataTypes.ENUM('manual', 'midtrans'),
      allowNull: false,
      defaultValue: 'manual'
    },
    paymentStatus: {
      type: DataTypes.ENUM('pending', 'settlement', 'expired', 'failed', 'refunded'),
      allowNull: false,
      defaultValue: 'pending'
    },
    midtransOrderId: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    },
    midtransTransactionId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    publicToken: {
      type: DataTypes.STRING(80),
      allowNull: false,
      unique: true,
      defaultValue: () => `ord_${crypto.randomBytes(24).toString('base64url')}`
    },
    grossAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'IDR'
    },
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    paymentType: {
      type: DataTypes.STRING,
      allowNull: true
    },
    vaNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },
    fraudStatus: {
      type: DataTypes.STRING,
      allowNull: true
    },
    rawNotification: {
      type: DataTypes.JSON,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Donations',
    tableName: 'Donations',
  });

  return Donations;
};
