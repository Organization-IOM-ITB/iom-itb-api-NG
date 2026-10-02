'use strict';

const { Op, literal } = require('sequelize');
const { StatusCodes } = require('http-status-codes');
const db = require('../models');
const BaseResponse = require('../schemas/responses/BaseResponse');
const triggerWhatsappNotification = require('../services/tallyWebhooks/triggerWhatsappNotification');
const sendEmail = require('../utils/mailer');
const { getRenderedEmailTemplate } = require('../services/payments/templates/templateRenderer');

const {
  logoAttachment,
  logoWhiteAttachment,
  wrapPengajuanEmailHtml,
  formatDate,
} = require('../utils/emailBantuan');

const ALLOWED_FORM_SLUGS = ['pendaftaran_anggota', 'pengajuan_bantuan', 'orang_tua_asuh', 'donasi'];

const STATUS_ALIASES = {
  VERIFIKASI_BERKAS: 'VERIFIKASI_BERKAS',
  DIPANGGIL_WAWANCARA: 'DIPANGGIL_WAWANCARA',
  KEPUTUSAN_DITERIMA: 'KEPUTUSAN_DITERIMA',
  KEPUTUSAN_DITOLAK: 'KEPUTUSAN_DITOLAK',
  TIDAK_DIKETAHUI: 'TIDAK_DIKETAHUI',
  'SEDANG DALAM PROSES VERIF BERKAS': 'VERIFIKASI_BERKAS',
  'DIPANGGIL WAWANCARA': 'DIPANGGIL_WAWANCARA',
  DITERIMA: 'KEPUTUSAN_DITERIMA',
  DITOLAK: 'KEPUTUSAN_DITOLAK',
  'KEPUTUSAN AKHIR DITERIMA': 'KEPUTUSAN_DITERIMA',
  'KEPUTUSAN AKHIR DITOLAK': 'KEPUTUSAN_DITOLAK',
};
const STATUS_LABELS = {
  VERIFIKASI_BERKAS: 'Sedang Dalam Proses Verifikasi Berkas',
  DIPANGGIL_WAWANCARA: 'Dipanggil Wawancara',
  KEPUTUSAN_DITERIMA: 'Keputusan Akhir Diterima',
  KEPUTUSAN_DITOLAK: 'Keputusan Akhir Ditolak',
};

function normalizeStatus(inputStatus) {
  if (!inputStatus) {
    return null;
  }

  const key = String(inputStatus).trim().toUpperCase();
  return STATUS_ALIASES[key] || null;
}

function normalizePagination(query) {
  const page = Number.parseInt(query.page, 10);
  const limit = Number.parseInt(query.limit, 10);

  return {
    page: Number.isNaN(page) || page < 1 ? 1 : page,
    limit: Number.isNaN(limit) || limit < 1 ? 10 : Math.min(limit, 100),
  };
}

function buildStatusMessage({
  nama,
  tallySubmissionId,
  status,
  catatan,
}) {
  const statusLabel =
    STATUS_LABELS[status] || status || 'TIDAK DIKETAHUI';

  const lines = [
    `Halo${nama ? ` ${nama}` : ''},`,
    '',
    'Status pengajuan bantuan Anda telah diperbarui.',
    '',
    `ID Pengajuan : ${tallySubmissionId}`,
    `Status       : ${statusLabel}`,
  ];

  if (catatan) {
    lines.push(`Catatan     : ${catatan}`);
  }

  lines.push(
    '',
    'Silakan login ke sistem untuk melihat detail pengajuan Anda.',
    '',
    'Mohon untuk tidak membalas email ini.',
    '',
    'Terima kasih.',
    'Tim Pengajuan Bantuan'
  );

  return lines.join('\n');
}

const ListTallySubmissionsByForm = async (req, res) => {
  try {
    const { formSlug } = req.params;
    const { search, sortBy, sortOrder, submittedFrom, submittedTo, status } = req.query;

    if (!ALLOWED_FORM_SLUGS.includes(formSlug)) {
      return res.status(StatusCodes.BAD_REQUEST).json(
        new BaseResponse({
          status: StatusCodes.BAD_REQUEST,
          message: 'Invalid formSlug',
        }),
      );
    }

    const { page, limit } = normalizePagination(req.query);

    const where = {
      formSlug,
    };

    if (submittedFrom || submittedTo) {
      where.submittedAt = {};
      if (submittedFrom) {
        where.submittedAt[Op.gte] = new Date(submittedFrom);
      }
      if (submittedTo) {
        where.submittedAt[Op.lte] = new Date(submittedTo);
      }
    }

    if (search && String(search).trim() !== '') {
      where[Op.or] = [
        {
          tallySubmissionId: {
            [Op.like]: `%${String(search).trim()}%`,
          },
        },
        literal(`CAST(payload AS CHAR) LIKE ${db.sequelize.escape(`%${String(search).trim()}%`)}`),
      ];
    }

    const include = [];
    if (formSlug === 'pengajuan_bantuan') {
      const normalizedStatus = normalizeStatus(status);
      include.push({
        model: db.PengajuanBantuanStatuses,
        as: 'pengajuanStatus',
        required: !!normalizedStatus,
        ...(normalizedStatus
          ? {
              where: {
                currentStatus: normalizedStatus,
              },
            }
          : {}),
      });
    }

    const safeSortBy = ['submittedAt', 'createdAt', 'updatedAt', 'tallySubmissionId'].includes(sortBy)
      ? sortBy
      : 'submittedAt';
    const safeSortOrder = String(sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const { rows, count } = await db.TallySubmissions.findAndCountAll({
      where,
      include,
      order: [[safeSortBy, safeSortOrder]],
      offset: (page - 1) * limit,
      limit,
    });

    return res.status(StatusCodes.OK).json({
      status: StatusCodes.OK,
      message: 'Success',
      data: rows,
      pagination: {
        currentPage: page,
        perPage: limit,
        totalEntries: typeof count === 'number' ? count : count.length,
        totalPages: Math.ceil((typeof count === 'number' ? count : count.length) / limit),
      },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(
      new BaseResponse({
        status: StatusCodes.INTERNAL_SERVER_ERROR,
        message: error.message || 'Failed to list submissions',
      }),
    );
  }
};

const GetTallySubmissionById = async (req, res) => {
  try {
    const { formSlug, tallySubmissionId } = req.params;

    if (!ALLOWED_FORM_SLUGS.includes(formSlug)) {
      return res.status(StatusCodes.BAD_REQUEST).json(
        new BaseResponse({
          status: StatusCodes.BAD_REQUEST,
          message: 'Invalid formSlug',
        }),
      );
    }

    const include = [];
    if (formSlug === 'pengajuan_bantuan') {
      include.push(
        {
          model: db.PengajuanBantuanStatuses,
          as: 'pengajuanStatus',
        },
        {
          model: db.PengajuanBantuanStatusHistories,
          as: 'pengajuanStatusHistories',
        },
      );
    }

    const submission = await db.TallySubmissions.findOne({
      where: {
        formSlug,
        tallySubmissionId,
      },
      include,
      order: [[{ model: db.PengajuanBantuanStatusHistories, as: 'pengajuanStatusHistories' }, 'changedAt', 'DESC']],
    });

    if (!submission) {
      return res.status(StatusCodes.NOT_FOUND).json(
        new BaseResponse({
          status: StatusCodes.NOT_FOUND,
          message: 'Submission not found',
        }),
      );
    }

    return res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: 'Success',
        data: submission,
      }),
    );
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(
      new BaseResponse({
        status: StatusCodes.INTERNAL_SERVER_ERROR,
        message: error.message || 'Failed to get submission',
      }),
    );
  }
};

const UpdatePengajuanBantuanStatus = async (req, res) => {
  try {
    const { tallySubmissionId } = req.params;
    const { status, catatan } = req.body;
    const actor =
      req.user?.preferred_username ||
      req.user?.email ||
      req.user?.sub ||
      'SYSTEM_API';

    const normalizedStatus = status ? normalizeStatus(status) : null;
    if (status && !normalizedStatus) {
      return res.status(StatusCodes.BAD_REQUEST).json(
        new BaseResponse({
          status: StatusCodes.BAD_REQUEST,
          message: 'Invalid status value',
        }),
      );
    }

    const result = await db.sequelize.transaction(async (transaction) => {
      const submission = await db.TallySubmissions.findOne({
        where: {
          formSlug: 'pengajuan_bantuan',
          tallySubmissionId,
        },
        transaction,
      });

      if (!submission) {
        return {
          notFound: true,
        };
      }

      const [currentStatusRow] = await db.PengajuanBantuanStatuses.findOrCreate({
        where: {
          submissionId: submission.id,
        },
        defaults: {
          submissionId: submission.id,
          currentStatus: 'VERIFIKASI_BERKAS',
          catatan: null,
          updatedBy: 'SYSTEM',
        },
        transaction,
      });

      const nextStatus = normalizedStatus || currentStatusRow.currentStatus;
      const nextCatatan = catatan === undefined ? currentStatusRow.catatan : catatan;

      const hasChanged =
        nextStatus !== currentStatusRow.currentStatus ||
        String(nextCatatan || '') !== String(currentStatusRow.catatan || '');

      if (!hasChanged) {
        return {
          unchanged: true,
          submission,
          statusRow: currentStatusRow,
        };
      }

      await db.PengajuanBantuanStatusHistories.create(
        {
          submissionId: submission.id,
          oldStatus: currentStatusRow.currentStatus,
          newStatus: nextStatus,
          oldCatatan: currentStatusRow.catatan,
          newCatatan: nextCatatan,
          changedBy: actor,
          changedAt: new Date(),
        },
        { transaction },
      );

      await currentStatusRow.update(
        {
          currentStatus: nextStatus,
          catatan: nextCatatan,
          updatedBy: actor,
        },
        { transaction },
      );

      return {
        unchanged: false,
        submission,
        statusRow: currentStatusRow,
      };
    });

    if (result.notFound) {
      return res.status(StatusCodes.NOT_FOUND).json(
        new BaseResponse({
          status: StatusCodes.NOT_FOUND,
          message: 'Pengajuan bantuan submission not found',
        }),
      );
    }

    if (!result.unchanged) {
      const payload =
        typeof result.submission?.payload === 'string'
          ? JSON.parse(result.submission.payload)
          : result.submission?.payload;

      const email = payload?.answersByLabel?.Email;
      const nama = payload?.answersByLabel?.Nama;

      if (email) {
        try {
          const statusLabel = STATUS_LABELS[result.statusRow.currentStatus] || result.statusRow.currentStatus || '-';
          const { subject, bodyHtml } = await getRenderedEmailTemplate(
            'pengajuan_bantuan_status_update',
            {
              name: nama || '-',
              submission_id: tallySubmissionId,
              status: statusLabel,
              catatan_line: result.statusRow.catatan || '',
              updated_at: formatDate(result.statusRow.updatedAt),
            },
            {
              subject: `Update Status Pengajuan Bantuan - ${statusLabel}`,
              body: `Halo {{name}},\n\nStatus pengajuan bantuan Anda telah diperbarui.\n\nID Pengajuan: {{submission_id}}\nStatus: {{status}}\nCatatan: {{catatan_line}}\nWaktu Update: {{updated_at}}\n\nSilakan login ke sistem untuk melihat detail pengajuan Anda.\n\nTerima kasih,\nTim Pengajuan Bantuan IOM ITB`,
            },
          );

          await sendEmail({
            to: email,
            subject,
            html: wrapPengajuanEmailHtml(bodyHtml),
            text: buildStatusMessage({
              nama,
              tallySubmissionId,
              status: result.statusRow.currentStatus,
              catatan: result.statusRow.catatan,
            }),
            attachments: [logoAttachment(), logoWhiteAttachment()],
          });
        } catch (err) {
          console.warn('[Email] Failed to send status update:', err.message);
        }
      }
    }

    return res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: result.unchanged ? 'No changes detected' : 'Status updated successfully',
        data: {
          tallySubmissionId,
          currentStatus: result.statusRow.currentStatus,
          catatan: result.statusRow.catatan,
          updatedBy: result.statusRow.updatedBy,
          updatedAt: result.statusRow.updatedAt,
        },
      }),
    );
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(
      new BaseResponse({
        status: StatusCodes.INTERNAL_SERVER_ERROR,
        message: error.message || 'Failed to update status',
      }),
    );
  }
};

const SendTallySubmissionWhatsapp = async (req, res) => {
  try {
    const { tallySubmissionId } = req.params;
    const formSlug = req.params.formSlug || 'pengajuan_bantuan';

    if (!ALLOWED_FORM_SLUGS.includes(formSlug)) {
      return res.status(StatusCodes.BAD_REQUEST).json(
        new BaseResponse({
          status: StatusCodes.BAD_REQUEST,
          message: 'Invalid formSlug',
        }),
      );
    }

    const submission = await db.TallySubmissions.findOne({
      where: {
        formSlug,
        tallySubmissionId,
      },
    });

    if (!submission) {
      return res.status(StatusCodes.NOT_FOUND).json(
        new BaseResponse({
          status: StatusCodes.NOT_FOUND,
          message: 'Pengajuan bantuan submission not found',
        }),
      );
    }

    const sendResult = await triggerWhatsappNotification({
      formSlug,
      submission,
      idempotencySuffix: `manual-${Date.now()}`,
    });

    if (!sendResult?.ok) {
      const status = sendResult?.skipped
        ? StatusCodes.BAD_REQUEST
        : StatusCodes.BAD_GATEWAY;

      return res.status(status).json(
        new BaseResponse({
          status,
          message: sendResult?.skipped
            ? `WhatsApp notification skipped: ${sendResult.reason || 'UNKNOWN'}`
            : `Failed to send WhatsApp notification: ${sendResult?.reason || 'UNKNOWN'}`,
          data: sendResult || null,
        }),
      );
    }

    return res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: 'WhatsApp notification sent successfully',
        data: sendResult,
      }),
    );
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(
      new BaseResponse({
        status: StatusCodes.INTERNAL_SERVER_ERROR,
        message: error.message || 'Failed to send WhatsApp notification',
      }),
    );
  }
};

module.exports = {
  ListTallySubmissionsByForm,
  GetTallySubmissionById,
  UpdatePengajuanBantuanStatus,
  SendTallySubmissionWhatsapp,
};
