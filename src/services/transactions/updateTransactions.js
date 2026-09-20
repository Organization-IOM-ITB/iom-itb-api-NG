const { Transactions, Merchandises, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const { restoreMerchandiseStock } = require('../payments/stockHelper');
const sendEmail = require('../../utils/mailer');
const sendWhatsApp = require('../../utils/whatsapp');
const { buildOrderStatusUrl } = require('../payments/templates/emailLayout');
const {
  buildTransactionShippingStatusEmail,
  SHIPPING_STATUS_COPY,
} = require('../payments/templates/paymentConfirmation');

const ALLOWED_STATUSES = ['waiting', 'on process', 'on delivery', 'arrived', 'done', 'canceled', 'denied'];
const RELEASE_STATUSES = new Set(['canceled', 'denied']);
const NOTIFY_STATUSES = new Set(['on process', 'on delivery', 'arrived', 'done', 'canceled', 'denied']);

const notifyShippingStatusUpdate = async (trx, status, merchandiseName) => {
  const copy = SHIPPING_STATUS_COPY[status] || { headline: `Status pesanan diperbarui menjadi: ${status}`, body: '' };
  const orderStatusUrl = buildOrderStatusUrl(trx.publicToken);
  const tasks = [];

  if (trx.noTelp) {
    const message = `Halo ${trx.username}!\n\n${copy.headline}\n\nKode Pesanan: ${trx.code}\nProduk: ${merchandiseName} x ${trx.qty}\nStatus: ${status}\n\n${copy.body}\n\nPantau status pesanan:\n${orderStatusUrl}\n\nSalam,\nIOM ITB`;
    tasks.push(
      sendWhatsApp(
        trx.noTelp,
        message,
        `transaction-${trx.id}-status-${status}`,
        `transaction-${trx.id}`
      )
    );
  }

  if (trx.email) {
    const email = buildTransactionShippingStatusEmail({
      username: trx.username,
      code: trx.code,
      merchandiseName,
      qty: trx.qty,
      address: trx.address,
      notes: trx.notes,
      status,
      transactionId: trx.id,
      orderStatusToken: trx.publicToken,
      orderStatusUrl,
    });
    tasks.push(
      sendEmail({
        to: trx.email,
        subject: email.subject,
        html: email.html,
        attachments: email.attachments,
      })
    );
  }

  await Promise.allSettled(tasks);
};

const UpdateTransactions = async (id, body) => {
  const { status } = body;

  if (status === undefined) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: 'Status must be provided for update',
    });
  }

  if (!ALLOWED_STATUSES.includes(status)) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}`,
    });
  }

  const tx = await sequelize.transaction();
  let updatedRecord = null;
  let merchandiseName = null;
  let releasingStock = false;
  try {
    const record = await Transactions.findByPk(id, {
      include: [{ model: Merchandises, as: 'merchandises' }],
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });

    if (!record) {
      throw new BaseError({ status: StatusCodes.NOT_FOUND, message: 'Transaction not found' });
    }

    if (record.status === status) {
      await tx.commit();
      return { status: StatusCodes.OK, message: 'No change', data: record };
    }

    const updates = { status };

    releasingStock = RELEASE_STATUSES.has(status) && record.stockDeducted;
    if (releasingStock) {
      await restoreMerchandiseStock(
        { merchandiseId: record.merchandiseId, qty: record.qty },
        tx
      );
      updates.stockDeducted = false;
    }

    await record.update(updates, { transaction: tx });
    await tx.commit();

    updatedRecord = record;
    merchandiseName = record.merchandises?.name || `Merchandise #${record.merchandiseId}`;

    if (NOTIFY_STATUSES.has(status)) {
      notifyShippingStatusUpdate(updatedRecord, status, merchandiseName).catch((err) => {
        console.error(`Failed to send shipping status notification for transaction ${updatedRecord.id}:`, err.message);
      });
    }

    return {
      status: StatusCodes.OK,
      message: releasingStock
        ? 'Transaction status updated, stock restored'
        : 'Transaction status updated',
    };
  } catch (error) {
    if (!tx.finished) await tx.rollback();
    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to update transaction status: ${error.message || error}`,
    });
  }
};

module.exports = UpdateTransactions;
