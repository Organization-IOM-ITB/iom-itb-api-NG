'use strict';

const { StatusCodes } = require('http-status-codes');
const { processTallyWebhook, FORM_SLUGS } = require('../services/tallyWebhooks/processTallyWebhook');
const BaseResponse = require('../schemas/responses/BaseResponse');

const createWebhookHandler = (formSlug) => {
  return async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body || {}), 'utf8');

      const result = await processTallyWebhook({
        formSlug,
        headers: req.headers,
        rawBody,
      });

      if (result.duplicated) {
        return res.status(StatusCodes.OK).json(
          new BaseResponse({
            status: StatusCodes.OK,
            message: 'Duplicate webhook event ignored',
          }),
        );
      }

      return res.status(StatusCodes.OK).json(
        new BaseResponse({
          status: StatusCodes.OK,
          message: 'Webhook processed successfully',
          data: {
            formSlug,
            tallySubmissionId: result.tallySubmissionId,
          },
        }),
      );
    } catch (error) {
      const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;

      return res.status(status).json(
        new BaseResponse({
          status,
          message: error.message || 'Webhook processing failed',
        }),
      );
    }
  };
};

module.exports = {
  handlePendaftaranAnggotaWebhook: createWebhookHandler(FORM_SLUGS.PENDAFTARAN_ANGGOTA),
  handlePengajuanBantuanWebhook: createWebhookHandler(FORM_SLUGS.PENGAJUAN_BANTUAN),
  handleOrangTuaAsuhWebhook: createWebhookHandler(FORM_SLUGS.ORANG_TUA_ASUH),
  handleDonasiWebhook: createWebhookHandler(FORM_SLUGS.DONASI),
};
