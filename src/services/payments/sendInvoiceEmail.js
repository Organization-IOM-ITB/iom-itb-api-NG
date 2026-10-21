const sendEmail = require('../../utils/mailer');
const { DonationDto, TransactionDto } = require('../../dtos/payments');
const buildDonationInvoice = require('./templates/donationInvoice');
const buildTransactionInvoice = require('./templates/transactionInvoice');
const { attachItems } = require('../transactions/orderItems');

const ADMIN_EMAIL = process.env.INVOICE_ADMIN_EMAIL || 'rizkyfathur326@gmail.com';

const sendBuiltInvoice = async (invoice) => {
  if (!invoice?.to) return null;

  return sendEmail({
    to: invoice.to,
    cc: ADMIN_EMAIL,
    subject: invoice.subject,
    html: invoice.html,
    attachments: invoice.attachments,
  });
};

const sendTransactionInvoice = async (trx) => {
  await attachItems(trx);
  const invoice = await buildTransactionInvoice(TransactionDto.fromModel(trx));
  return sendBuiltInvoice(invoice);
};

const sendDonationInvoice = async (donation) => {
  const invoice = await buildDonationInvoice(DonationDto.fromModel(donation));
  return sendBuiltInvoice(invoice);
};

module.exports = {
  sendTransactionInvoice,
  sendDonationInvoice,
};
