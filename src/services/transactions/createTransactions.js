const { Transactions, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const sendEmail = require('../../utils/mailer');
const sendWhatsApp = require('../../utils/whatsapp');
const { buildTransactionProofReceivedEmail } = require('../payments/templates/paymentConfirmation');
const { buildOrderStatusUrl } = require('../payments/templates/emailLayout');
const { generateOrderTrackingToken } = require('../../utils/orderTrackingToken');
const { resolveShipping } = require('./shippingQuote');
const {
  parseOrderItems,
  reserveOrderItems,
  headerFromLines,
  saveOrderItems,
  formatOrderLines,
} = require('./orderItems');
const fs = require('fs');
const path = require('path');

const formatIDR = (n) => Number(n || 0).toLocaleString('id-ID');

const notifyTransactionProofReceived = async (trx, lines) => {
  const amount = formatIDR(trx.grossAmount);
  const shippingLine = trx.shippingCost != null ? `Ongkir: Rp ${formatIDR(trx.shippingCost)}\n` : '';
  const orderStatusUrl = buildOrderStatusUrl(trx.publicToken);
  const tasks = [];

  if (trx.noTelp) {
    const message = `Halo ${trx.username}!\n\nBukti pembayaran Anda telah kami terima.\n\nKode Pesanan: ${trx.code}\nProduk: ${formatOrderLines(lines)}\n${shippingLine}Total: Rp ${amount}\n\nTim IOM ITB akan memverifikasi pembayaran dalam 1x24 jam. Anda dapat memantau status pesanan melalui tautan berikut:\n${orderStatusUrl}\n\nSalam,\nIOM ITB`;
    tasks.push(
      sendWhatsApp(
        trx.noTelp,
        message,
        `transaction-${trx.id}-proof-received`,
        `transaction-${trx.id}`
      )
    );
  }

  if (trx.email) {
    const email = buildTransactionProofReceivedEmail({
      username: trx.username,
      code: trx.code,
      lines,
      amount,
      shippingCost: trx.shippingCost != null ? formatIDR(trx.shippingCost) : null,
      notes: trx.notes,
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

const CreateTransaction = async (body, files, uploadPath) => {
  const imageFile = files && files['payment'] ? files['payment'][0] : null;
  const { username, email, noTelp, address, notes } = body;

  const transaction = await sequelize.transaction();
  try {
    // Validasi di dalam try agar bukti bayar yang sudah terunggah ikut
    // dihapus bila input/alamat tidak valid.
    if (!username || !email || !noTelp || !address) {
      throw new BaseError({
        status: StatusCodes.BAD_REQUEST,
        message: 'username, email, noTelp, and address are required fields',
      });
    }
    const items = parseOrderItems(body);
    const shipping = resolveShipping(address);

    const { lines, subtotal } = await reserveOrderItems(items, transaction);

    // Multer (middlewares/multer.js) actually saves uploaded files to
    // src/uploads/, served statically at the /uploads prefix (see app.js) —
    // not /public/images/transactions, which nothing ever writes to.
    const imageFileName = imageFile ? `${uploadPath}/uploads/${imageFile.filename}` : null;
    const grossAmount = subtotal + shipping.cost;

    const newTransaction = await Transactions.create(
      {
        username,
        email,
        noTelp,
        address,
        ...headerFromLines(lines),
        payment: imageFileName,
        publicToken: generateOrderTrackingToken(),
        status: 'waiting',
        paymentMethod: 'manual',
        paymentStatus: 'pending',
        grossAmount,
        shippingCost: shipping.cost,
        shippingZone: shipping.zone,
        stockDeducted: true,
        notes: notes || null,
      },
      { transaction }
    );

    newTransaction.code = `IOM-${Date.now()}-${newTransaction.id}`;
    await newTransaction.save({ transaction });
    await saveOrderItems(newTransaction.id, lines, transaction);

    await transaction.commit();

    notifyTransactionProofReceived(newTransaction, lines).catch((err) => {
      console.error(`Failed to send proof-received notification for transaction ${newTransaction.id}:`, err.message);
    });

    return {
      code: newTransaction.code,
      message: 'Transaction created successfully',
      orderStatusToken: newTransaction.publicToken,
      orderStatusUrl: buildOrderStatusUrl(newTransaction.publicToken),
    };
  } catch (error) {
    await transaction.rollback();

    if (files && imageFile) {
      const imageFilePath = path.join(__dirname, '../../uploads', imageFile.filename);
      if (fs.existsSync(imageFilePath)) {
        fs.unlinkSync(imageFilePath);
      }
    }

    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to create transaction: ${error.message || error}`,
    });
  }
};

module.exports = CreateTransaction;
