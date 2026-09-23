const { Donations, Transactions, Merchandises, sequelize, EmailTemplate } = require('../../models');
const { DonationDto, TransactionDto } = require('../../dtos/payments');
const sendEmail = require('../../utils/mailer');
const sendWhatsApp = require('../../utils/whatsapp');
const { normalizeWhatsAppRecipient } = require('../../utils/whatsappPhone');
const { buildOrderStatusUrl } = require('./templates/emailLayout');
const { restoreMerchandiseStock } = require('./stockHelper');
const {
  buildDonationPaymentEmail,
  buildTransactionPaymentEmail,
} = require('./templates/paymentConfirmation');

const getWaMessage = async (key, data, fallback) => {
  const template = await EmailTemplate.findOne({ where: { key, isActive: true } });
  const body = template?.body || fallback;
  return body.replace(/{{\s*(\w+)\s*}}/g, (_, k) => data[k] ?? '');
};

const assertAmountMatches = (orderId, expected, actual) => {
  if (expected == null) return;
  if (Number(actual) !== Number(expected)) {
    throw new Error(`Amount mismatch for ${orderId}: expected ${expected}, got ${actual}`);
  }
};

const sendNotificationEmail = async (to, email) => {
  if (!to || !email) return null;
  return sendEmail({
    to,
    subject: email.subject,
    html: email.html,
    attachments: email.attachments,
  });
};

/**
 * @param {DonationDto} donation
 * @param {string} transactionId
 */
const notifyDonationPaid = async (donation, transactionId) => {
  const channels = donation.getNotificationChannels();
  const tasks = [];
  const confirmationPayload = donation.toPaymentConfirmationPayload(transactionId);

  if (channels.whatsapp && donation.noWhatsapp) {
    const phoneResult = normalizeWhatsAppRecipient(donation.noWhatsapp, {
      defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '62',
    });
    if (phoneResult.isValid) {
      const message = await getWaMessage(
        'donation_payment_whatsapp',
        { name: donation.name, amount: confirmationPayload.amount },
        `Halo ${donation.name}!\n\nPembayaran donasi Anda sebesar Rp ${confirmationPayload.amount} telah berhasil dikonfirmasi.\n\nTerima kasih atas kontribusi Anda kepada IOM ITB!\n\nSalam,\nIOM ITB`
      );
      tasks.push(
        sendWhatsApp(
          phoneResult.normalized,
          message,
          `donation-${donation.id}-paid`,
          `donation-${donation.id}`
        )
      );
    } else {
      console.warn(`[WA] Invalid donation phone for id=${donation.id}: ${donation.noWhatsapp} (${phoneResult.reason})`);
    }
  }

  if (donation.email) {
    const email = await buildDonationPaymentEmail(confirmationPayload);
    tasks.push(sendNotificationEmail(donation.email, email));
  }

  await Promise.allSettled(tasks);
};

/**
 * @param {TransactionDto} trx
 * @param {string} transactionId
 */
const notifyTransactionPaid = async (trx, transactionId) => {
  const tasks = [];
  const confirmationPayload = trx.toPaymentConfirmationPayload(transactionId);
  const orderStatusUrl = buildOrderStatusUrl(confirmationPayload.orderStatusToken);

  if (trx.noTelp) {
    const phoneResult = normalizeWhatsAppRecipient(trx.noTelp, {
      defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '62',
    });
    if (phoneResult.isValid) {
      const message = await getWaMessage(
        'transaction_payment_whatsapp',
        {
          username: trx.username,
          code: confirmationPayload.code,
          merchandise_name: confirmationPayload.merchandiseName,
          qty: trx.qty,
          notes: trx.notes || '',
          notes_block: trx.notes ? `Catatan: ${trx.notes}` : '',
          amount: confirmationPayload.amount,
          order_status_url: orderStatusUrl,
        },
        `Halo ${trx.username}!\n\nPembayaran pesanan Anda telah berhasil!\n\nKode Pesanan: ${confirmationPayload.code}\nProduk: ${confirmationPayload.merchandiseName} x ${trx.qty}${trx.notes ? `\nCatatan: ${trx.notes}` : ''}\nTotal: Rp ${confirmationPayload.amount}\n\nPesanan Anda sedang diproses. Pantau status pesanan melalui tautan berikut:\n${orderStatusUrl}\n\nSalam,\nIOM ITB`
      );
      tasks.push(
        sendWhatsApp(
          phoneResult.normalized,
          message,
          `transaction-${trx.id}-paid`,
          `transaction-${trx.id}`
        )
      );
    } else {
      console.warn(`[WA] Invalid transaction phone for id=${trx.id}: ${trx.noTelp} (${phoneResult.reason})`);
    }
  }

  if (trx.email) {
    const email = await buildTransactionPaymentEmail({
      ...confirmationPayload,
      orderStatusUrl,
    });

    tasks.push(sendNotificationEmail(trx.email, email));
  }

  const results = await Promise.allSettled(tasks);
  console.log('TRANSACTION NOTIFICATION RESULTS:', results);
};

/**
 * @param {import('../../dtos/payments').PaymentNotificationDto} notification
 * @returns {Promise<{ message: string, paymentStatus?: string }>}
 */
const processDonationPayment = async (notification) => {
  let donationDto = null;
  let currentState = 'updated';
  let shouldNotifyPaid = false;

  await sequelize.transaction(async (transaction) => {
    const donation = await Donations.findOne({
      where: { midtransOrderId: notification.orderId },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });

    if (!donation) {
      currentState = 'not_found';
      return;
    }
    const previousPaymentStatus = donation.paymentStatus;

    assertAmountMatches(notification.orderId, donation.grossAmount, notification.grossAmount);

    const updates = {
      paymentStatus: notification.paymentStatus,
      midtransTransactionId: notification.transactionId,
      paymentType: notification.paymentType || donation.paymentType,
      vaNumber: notification.vaNumber || donation.vaNumber,
      fraudStatus: notification.fraudStatus || donation.fraudStatus,
      rawNotification: notification.raw,
    };

    if (notification.isPaid) {
      updates.proof = `midtrans:${notification.transactionId}`;
      updates.date = notification.paidAt;
      updates.paidAt = notification.paidAt;
    }

    await donation.update(updates, { transaction });
    donationDto = DonationDto.fromModel(donation);
    shouldNotifyPaid = notification.isPaid && previousPaymentStatus !== 'settlement';
  });

  if (currentState === 'not_found') return { message: 'Donation not found', paymentStatus: notification.paymentStatus };

  if (shouldNotifyPaid && donationDto) {
    await notifyDonationPaid(donationDto, notification.transactionId);
    return { message: 'Payment processed', paymentStatus: notification.paymentStatus };
  }

  return { message: `Payment status: ${notification.paymentStatus}`, paymentStatus: notification.paymentStatus };
};

/**
 * @param {import('../../dtos/payments').PaymentNotificationDto} notification
 * @returns {Promise<{ message: string, paymentStatus?: string }>}
 */
const processTransactionPayment = async (notification) => {
  let transactionDto = null;
  let currentState = 'updated';
  let shouldNotifyPaid = false;

  await sequelize.transaction(async (transaction) => {
    const trx = await Transactions.findOne({
      where: { midtransOrderId: notification.orderId },
      include: [{ model: Merchandises, as: 'merchandises' }],
      lock: transaction.LOCK.UPDATE,
      transaction,
    });

    if (!trx) {
      currentState = 'not_found';
      return;
    }
    const previousPaymentStatus = trx.paymentStatus;

    assertAmountMatches(notification.orderId, trx.grossAmount, notification.grossAmount);

    const updates = {
      paymentStatus: notification.paymentStatus,
      midtransTransactionId: notification.transactionId,
      paymentType: notification.paymentType || trx.paymentType,
      vaNumber: notification.vaNumber || trx.vaNumber,
      fraudStatus: notification.fraudStatus || trx.fraudStatus,
      rawNotification: notification.raw,
    };

    if (notification.isPaid) {
      updates.status = 'on process';
      updates.payment = `midtrans:${notification.transactionId}`;
      updates.paidAt = notification.paidAt;
    } else if (notification.isFailed) {
      updates.status = 'canceled';
      if (trx.stockDeducted) {
        await restoreMerchandiseStock(
          { merchandiseId: trx.merchandiseId, qty: trx.qty },
          transaction
        );
        updates.stockDeducted = false;
      }
    }

    await trx.update(updates, { transaction });
    transactionDto = TransactionDto.fromModel(trx);
    shouldNotifyPaid = notification.isPaid && previousPaymentStatus !== 'settlement';
  });

  if (currentState === 'not_found') return { message: 'Transaction not found', paymentStatus: notification.paymentStatus };

  if (shouldNotifyPaid && transactionDto) {
    await notifyTransactionPaid(transactionDto, notification.transactionId);
    return { message: 'Payment processed', paymentStatus: notification.paymentStatus };
  }

  return { message: `Payment status: ${notification.paymentStatus}`, paymentStatus: notification.paymentStatus };
};

/**
 * @param {import('../../dtos/payments').PaymentNotificationDto} notification
 * @returns {Promise<{ message: string, paymentStatus?: string }>}
 */
const processPaymentUpdate = async (notification) => {
  if (notification.scope === 'donation') {
    return processDonationPayment(notification);
  }

  if (notification.scope === 'transaction') {
    return processTransactionPayment(notification);
  }

  return { message: 'Unknown order type', paymentStatus: notification.paymentStatus };
};

module.exports = processPaymentUpdate;
module.exports.notifyTransactionPaid = notifyTransactionPaid;
