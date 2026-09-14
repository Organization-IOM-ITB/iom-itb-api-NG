const { Donations, Transactions, Merchandises, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const { snap } = require('../../utils/midtrans');
const { decreaseMerchandiseStock, restoreMerchandiseStock } = require('./stockHelper');
const { getDonationAmountBreakdown } = require('../donations/donationAmount');
const { generateOrderTrackingToken } = require('../../utils/orderTrackingToken');

const SNAP_EXPIRY_HOURS = 24;

const formatMidtransStartTime = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const offH = pad(Math.floor(Math.abs(offsetMin) / 60));
  const offM = pad(Math.abs(offsetMin) % 60);
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} ${sign}${offH}${offM}`;
};

const createDonationSnapToken = async (payload) => {
  const { name, email, noWhatsapp, amount, donationType, facultyId, notification, nameIsHidden, isHambaAllah } = payload;

  if (!name || !email || !noWhatsapp || !amount) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: 'name, email, noWhatsapp, and amount are required',
    });
  }

  const amountBreakdown = await getDonationAmountBreakdown({ amount, facultyId });

  let donation;
  const tx = await sequelize.transaction();
  try {
    donation = await Donations.create({
      name,
      email,
      noWhatsapp,
      notification: notification || [],
      amount: amountBreakdown.baseAmount,
      options: {
        donationType: donationType || null,
        facultyId: amountBreakdown.facultyId,
        nameIsHidden: nameIsHidden || false,
        isHambaAllah: isHambaAllah || false,
      },
      donationType: donationType || null,
      facultyId: amountBreakdown.facultyId,
      kodeUnik: amountBreakdown.uniqueCode,
      bank: 'Midtrans',
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      publicToken: generateOrderTrackingToken(),
      grossAmount: amountBreakdown.grossAmount,
    }, { transaction: tx });

    const orderId = `DONATION-${Date.now()}-${donation.id}`;
    await donation.update({ midtransOrderId: orderId }, { transaction: tx });
    await tx.commit();

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amountBreakdown.grossAmount,
      },
      customer_details: {
        first_name: name,
        email,
        phone: noWhatsapp,
      },
      item_details: [{
        id: `donation-${donationType || 'umum'}`,
        price: amountBreakdown.baseAmount,
        quantity: 1,
        name: `Donasi IOM ITB${donationType ? ` — ${donationType}` : ''}`,
      }, {
        id: `faculty-unique-code-${amountBreakdown.facultyId}`,
        price: amountBreakdown.uniqueCodeAmount,
        quantity: 1,
        name: `Kode Unik Fakultas ${amountBreakdown.facultyName}`,
      }],
      expiry: {
        start_time: formatMidtransStartTime(),
        unit: 'hours',
        duration: SNAP_EXPIRY_HOURS,
      },
      callbacks: {
        notification: `${process.env.BASE_URL}/payments/notification`,
      },
    };

    const snapToken = await snap.createTransaction(parameter);
    return {
      token: snapToken.token,
      orderId,
      amount: amountBreakdown.baseAmount,
      grossAmount: amountBreakdown.grossAmount,
      uniqueCode: amountBreakdown.uniqueCode,
      facultyName: amountBreakdown.facultyName,
      publicToken: donation.publicToken,
    };
  } catch (error) {
    if (tx && !tx.finished) await tx.rollback();
    if (donation) await donation.destroy().catch(() => {});
    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to create donation snap token: ${error.message}`,
    });
  }
};

const createTransactionSnapToken = async (payload) => {
  const { merchandiseId, username, email, noTelp, address, qty } = payload;

  if (!merchandiseId || !username || !email || !noTelp || !address || qty == null) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: 'merchandiseId, username, email, noTelp, address, and qty are required',
    });
  }

  const qtyNum = Number(qty);
  if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
    throw new BaseError({ status: StatusCodes.BAD_REQUEST, message: 'qty must be a positive integer' });
  }

  let newTransaction;
  let grossAmount;
  let merchandiseName;
  let merchandisePrice;

  const tx = await sequelize.transaction();
  try {
    const merchandise = await Merchandises.findByPk(merchandiseId, {
      transaction: tx,
      lock: tx.LOCK.UPDATE,
    });
    if (!merchandise) {
      throw new BaseError({ status: StatusCodes.NOT_FOUND, message: 'Merchandise not found' });
    }

    await decreaseMerchandiseStock({ merchandiseId, qty: qtyNum }, tx);

    merchandisePrice = Math.round(Number(merchandise.price));
    merchandiseName = merchandise.name;
    grossAmount = merchandisePrice * qtyNum;

    const expiredAt = new Date(Date.now() + SNAP_EXPIRY_HOURS * 60 * 60 * 1000);

    newTransaction = await Transactions.create({
      username,
      email,
      noTelp,
      address,
      merchandiseId,
      qty: qtyNum,
      payment: null,
      publicToken: generateOrderTrackingToken(),
      status: 'waiting',
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      grossAmount,
      expiredAt,
      stockDeducted: true,
    }, { transaction: tx });

    const code = `IOM-${Date.now()}-${newTransaction.id}`;
    await newTransaction.update(
      { code, midtransOrderId: code },
      { transaction: tx }
    );
    await tx.commit();

    const parameter = {
      transaction_details: {
        order_id: code,
        gross_amount: grossAmount,
      },
      customer_details: {
        first_name: username,
        email,
        phone: noTelp,
        shipping_address: { address },
      },
      item_details: [{
        id: String(merchandiseId),
        price: merchandisePrice,
        quantity: qtyNum,
        name: merchandiseName,
      }],
      expiry: {
        start_time: formatMidtransStartTime(),
        unit: 'hours',
        duration: SNAP_EXPIRY_HOURS,
      },
      callbacks: {
        notification: `${process.env.BASE_URL}/payments/notification`,
      },
    };

    try {
      const snapToken = await snap.createTransaction(parameter);
      return {
        token: snapToken.token,
        orderId: code,
        code,
        publicToken: newTransaction.publicToken,
        grossAmount,
      };
    } catch (snapError) {
      const compensateTx = await sequelize.transaction();
      try {
        await restoreMerchandiseStock({ merchandiseId, qty: qtyNum }, compensateTx);
        await newTransaction.update(
          { stockDeducted: false, paymentStatus: 'failed', status: 'canceled' },
          { transaction: compensateTx }
        );
        await compensateTx.commit();
      } catch (compensateErr) {
        if (!compensateTx.finished) await compensateTx.rollback();
      }
      throw snapError;
    }
  } catch (error) {
    if (tx && !tx.finished) await tx.rollback();
    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to create transaction snap token: ${error.message}`,
    });
  }
};

module.exports = { createDonationSnapToken, createTransactionSnapToken };
