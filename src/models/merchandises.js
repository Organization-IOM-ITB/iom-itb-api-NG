'use strict';
const { Model } = require('sequelize');
const { parseStored } = require('../utils/merchandiseOptions');

module.exports = (sequelize, DataTypes) => {
  class Merchandises extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Define any associations if needed in the future
    }

    static async getMerchandiseByKeyword(keyword) {
      return this.findAll({
        where: {
          name: { [Op.like]: `%${keyword}%` }
        }
      });
    }
  }
  
  Merchandises.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    image: {
      type: DataTypes.STRING,
      allowNull: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    hpp: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0
    },
    stock: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    link: {
      type: DataTypes.STRING,
      allowNull: true
    },
    kategori: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // Berat per pcs dalam gram, termasuk kemasan (untuk ongkir). NULL =
    // belum diisi → DEFAULT_ITEM_WEIGHT_GRAMS di utils/shippingRates.js.
    weight: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    // Opsi pilihan pembeli (Warna/Lengan/Size), lihat utils/merchandiseOptions.js.
    options: {
      type: DataTypes.JSON,
      allowNull: true,
      get() {
        return parseStored(this.getDataValue('options')) || null;
      }
    },
  }, {
    sequelize,
    modelName: 'Merchandises',
    tableName: 'Merchandises',
  });

  return Merchandises;
};
