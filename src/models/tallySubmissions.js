'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TallySubmissions extends Model {
    static associate(models) {
      TallySubmissions.hasOne(models.PengajuanBantuanStatuses, {
        foreignKey: 'submissionId',
        as: 'pengajuanStatus',
      });

      TallySubmissions.hasMany(models.PengajuanBantuanStatusHistories, {
        foreignKey: 'submissionId',
        as: 'pengajuanStatusHistories',
      });
    }
  }

  TallySubmissions.init(
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      tallySubmissionId: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      respondentId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      formId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      formSlug: {
        type: DataTypes.ENUM('pendaftaran_anggota', 'pengajuan_bantuan', 'orang_tua_asuh', 'donasi'),
        allowNull: false,
      },
      submittedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      extractedWhatsapp: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      sourceType: {
        type: DataTypes.ENUM('webhook', 'csv_seed'),
        allowNull: false,
        defaultValue: 'webhook',
      },
    },
    {
      sequelize,
      modelName: 'TallySubmissions',
      tableName: 'TallySubmissions',
      indexes: [
        {
          name: 'uq_tally_submissions_form_slug_submission_id',
          unique: true,
          fields: ['formSlug', 'tallySubmissionId'],
        },
        {
          name: 'idx_tally_submissions_form_slug_submitted_at',
          fields: ['formSlug', 'submittedAt'],
        },
      ],
    },
  );

  return TallySubmissions;
};
