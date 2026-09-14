const { coreApi } = require('../../utils/midtrans');
const { Donations, Transactions } = require('../../models');
const { PaymentNotificationDto } = require('../../dtos/payments');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const logPaymentEvent = require('./logPaymentEvent');
const processPaymentUpdate = require('./processPaymentUpdate');
const {
  PAYMENT_SESSION_STATES,
  getMidtransStatusOrNull,
  getPaymentSessionState,
} = require('./midtransGatewayState');

const TERMINAL_STATUSES = new Set(['failed', 'expired', 'refunded']);
const CANCELLABLE_TRANSACTION_STATUSES = new Set(['pending', 'capture', 'authorize']);

const assertPublicCancelAuthorized = async (orderId, publicToken) => {
  if (!publicToken) {
    throw new BaseError({
      status: StatusCodes.FORBIDDEN,
      message: 'publicToken is required.',
    });
  }

  if (orderId.startsWith('DONATION-')) {
    const donation = await Donations.findOne({
      where: { midtransOrderId: orderId, publicToken },
      attributes: ['id'],
    });
    if (donation) return;
  } else if (orderId.startsWith('IOM-')) {
    const trx = await Transactions.findOne({
      where: { midtransOrderId: orderId, publicToken },
      attributes: ['id'],
    });
    if (trx) return;
  }

  throw new BaseError({
    status: StatusCodes.FORBIDDEN,
    message: 'Invalid cancel token.',
  });
};

const syncMidtransStatus = async (statusResponse) => {
  const paymentDto = PaymentNotificationDto.fromMidtransRaw(statusResponse);
  const result = await processPaymentUpdate(paymentDto);

  return {
    result: {
      ...result,
      paymentStatus: result?.paymentStatus || paymentDto.paymentStatus || null,
    },
    payload: statusResponse,
    paymentStatus: paymentDto.paymentStatus,
    transactionStatus: paymentDto.transactionStatus,
  };
};

const cancelPayment = async (orderId, opts = {}) => {
  if (!orderId) throw new Error('orderId is required');
  await assertPublicCancelAuthorized(orderId, opts.publicToken);

  const currentStatus = await getMidtransStatusOrNull(coreApi, orderId);

  if (!currentStatus) {
    return {
      result: {
        message: 'Payment session has not been started in Midtrans.',
        paymentStatus: null,
        paymentSessionState: PAYMENT_SESSION_STATES.NOT_STARTED,
      },
      payload: { order_id: orderId },
      paymentStatus: null,
      transactionStatus: null,
    };
  }

  const current = PaymentNotificationDto.fromMidtransRaw(currentStatus);

  if (current.transactionStatus === 'settlement') {
    return {
      result: {
        message: 'Settled transaction cannot be canceled.',
        paymentStatus: 'settlement',
        paymentSessionState: PAYMENT_SESSION_STATES.SETTLEMENT,
      },
      payload: currentStatus,
      paymentStatus: current.paymentStatus,
      transactionStatus: current.transactionStatus,
    };
  }

  if (TERMINAL_STATUSES.has(current.paymentStatus) || current.transactionStatus === 'cancel') {
    const synced = await syncMidtransStatus(currentStatus);
    return {
      ...synced,
      result: {
        ...synced.result,
        paymentSessionState: getPaymentSessionState(synced),
      },
    };
  }

  if (!CANCELLABLE_TRANSACTION_STATUSES.has(current.transactionStatus)) {
    return {
      result: {
        message: `Transaction with status ${current.transactionStatus || current.paymentStatus} cannot be canceled.`,
        paymentStatus: current.paymentStatus,
        paymentSessionState: PAYMENT_SESSION_STATES.UNCHANGED,
      },
      payload: currentStatus,
      paymentStatus: current.paymentStatus,
      transactionStatus: current.transactionStatus,
    };
  }

  const cancelResponse = await coreApi.transaction.cancel(orderId);
  const synced = await syncMidtransStatus(cancelResponse);

  return {
    ...synced,
    result: {
      ...synced.result,
      paymentSessionState: getPaymentSessionState(synced),
    },
  };
};

const cancelPaymentWithLogging = async (orderId, opts = {}) => {
  let result;
  let error = null;
  let payload = { order_id: orderId };
  let paymentStatus = null;

  try {
    const cancellation = await cancelPayment(orderId, opts);
    result = cancellation.result;
    payload = cancellation.payload || payload;
    paymentStatus = cancellation.paymentStatus || null;
    return result;
  } catch (err) {
    error = err.message;
    throw err;
  } finally {
    await logPaymentEvent({
      source: 'system',
      payload,
      paymentStatus,
      processed: !error,
      error,
      ipAddress: opts.ipAddress,
    });
  }
};

module.exports = cancelPaymentWithLogging;
