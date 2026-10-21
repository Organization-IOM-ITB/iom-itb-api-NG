const { Donations, Transactions, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const { snap } = require('../../utils/midtrans');
const { getDonationAmountBreakdown } = require('../donations/donationAmount');
const { generateOrderTrackingToken } = require('../../utils/orderTrackingToken');
const { resolveShipping } = require('../transactions/shippingQuote');
const { describeSelectedOptions } = require('../../utils/merchandiseOptions');
const {
  parseOrderItems,
  reserveOrderItems,
  headerFromLines,
  saveOrderItems,
  releaseOrderStock,
} = require('../transactions/orderItems');

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
  const { username, email, noTelp, address, notes } = payload;

  if (!username || !email || !noTelp || !address) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: 'username, email, noTelp, and address are required',
    });
  }

  const items = parseOrderItems(payload);
  resolveShipping(address); // tolak alamat tak dikenal sebelum mengunci stok

  let newTransaction;
  let grossAmount;
  let lines;
  let shipping;

  const tx = await sequelize.transaction();
  try {
    const reserved = await reserveOrderItems(items, tx);
    lines = reserved.lines;
    shipping = resolveShipping(address, reserved.weightGrams);
    grossAmount = reserved.subtotal + shipping.cost;

    const expiredAt = new Date(Date.now() + SNAP_EXPIRY_HOURS * 60 * 60 * 1000);

    newTransaction = await Transactions.create({
      username,
      email,
      noTelp,
      address,
      ...headerFromLines(lines),
      payment: null,
      publicToken: generateOrderTrackingToken(),
      status: 'waiting',
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      grossAmount,
      shippingCost: shipping.cost,
      shippingZone: shipping.zone,
      shippingWeight: reserved.weightGrams,
      expiredAt,
      stockDeducted: true,
      notes: notes || null,
    }, { transaction: tx });

    const code = `IOM-${Date.now()}-${newTransaction.id}`;
    await newTransaction.update(
      { code, midtransOrderId: code },
      { transaction: tx }
    );
    await saveOrderItems(newTransaction.id, lines, tx);
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
      item_details: [
        ...lines.map((line, index) => ({
          id: lines.length === 1 ? String(line.merchandiseId) : `${line.merchandiseId}-${index + 1}`,
          price: line.unitPrice,
          quantity: line.qty,
          // Midtrans membatasi nama item 50 karakter.
          name: [line.merchandiseName, describeSelectedOptions(line.selectedOptions)].filter(Boolean).join(' - ').slice(0, 50),
        })),
        {
          // Midtrans menolak bila jumlah item_details != gross_amount.
          id: `shipping-${shipping.zone}`,
          price: shipping.cost,
          quantity: 1,
          name: `Ongkir ${shipping.zoneLabel} ${shipping.billedKg} kg`.slice(0, 50),
        },
      ],
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
        await releaseOrderStock(newTransaction, compensateTx);
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
