'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TallyWebhookEvents extends Model {
    static associate() {}
  }

  TallyWebhookEvents.init(
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      eventKey: {
        type: DataTypes.STRING(191),
        allowNull: false,
        unique: true,
      },
      formSlug: {
        type: DataTypes.ENUM('pendaftaran_anggota', 'pengajuan_bantuan', 'orang_tua_asuh', 'donasi'),
        allowNull: false,
      },
      signatureHeader: {
        type: DataTypes.STRING(512),
        allowNull: true,
      },
      headersJson: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      payloadJson: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      processStatus: {
        type: DataTypes.ENUM('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED_DUPLICATE'),
        allowNull: false,
        defaultValue: 'RECEIVED',
      },
      errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      receivedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      processedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'TallyWebhookEvents',
      tableName: 'TallyWebhookEvents',
    },
  );

  return TallyWebhookEvents;
};
