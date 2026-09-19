const { Transactions, Merchandises, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const { TransactionDto } = require('../../dtos/payments');
const { notifyTransactionPaid } = require('../payments/processPaymentUpdate');

// Konfirmasi pembayaran manual (transfer bank) oleh admin setelah memeriksa
// bukti transfer. Transaksi Midtrans TIDAK boleh lewat sini — statusnya
// hanya boleh berubah lewat webhook/verify Midtrans (lihat processPaymentUpdate.js),
// supaya paymentStatus selalu mencerminkan status asli di gateway.
const ConfirmManualPayment = async (id) => {
  let updatedRecord = null;
  let merchandiseName = null;
  let alreadyConfirmed = false;

  const tx = await sequelize.transaction();
  try {
    const record = await Transactions.findByPk(id, {
      include: [{ model: Merchandises, as: 'merchandises' }],
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });

    if (!record) {
      throw new BaseError({ status: StatusCodes.NOT_FOUND, message: 'Transaction not found' });
    }

    if (record.paymentMethod !== 'manual') {
      throw new BaseError({
        status: StatusCodes.BAD_REQUEST,
        message: 'Hanya transaksi dengan metode transfer manual yang bisa dikonfirmasi lewat sini. Transaksi Midtrans mengikuti status dari gateway pembayaran.',
      });
    }

    if (record.paymentStatus === 'settlement') {
      alreadyConfirmed = true;
      await tx.commit();
      updatedRecord = record;
      merchandiseName = record.merchandises?.name || `Merchandise #${record.merchandiseId}`;
    } else {
      const updates = { paymentStatus: 'settlement', paidAt: new Date() };
      if (record.status === 'waiting') {
        updates.status = 'on process';
      }

      await record.update(updates, { transaction: tx });
      await tx.commit();

      updatedRecord = record;
      merchandiseName = record.merchandises?.name || `Merchandise #${record.merchandiseId}`;
    }
  } catch (error) {
    if (!tx.finished) await tx.rollback();
    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to confirm payment: ${error.message || error}`,
    });
  }

  if (!alreadyConfirmed) {
    const trxDto = TransactionDto.fromModel({ ...updatedRecord.toJSON(), merchandiseName });
    notifyTransactionPaid(trxDto, updatedRecord.code || String(updatedRecord.id)).catch((err) => {
      console.error(`Failed to send payment-confirmed notification for transaction ${updatedRecord.id}:`, err.message);
    });
  }

  return {
    status: StatusCodes.OK,
    message: alreadyConfirmed ? 'Payment was already confirmed' : 'Payment confirmed',
    data: updatedRecord,
  };
};

module.exports = ConfirmManualPayment;
