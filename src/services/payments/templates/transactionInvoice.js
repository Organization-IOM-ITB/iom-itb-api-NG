const { Merchandises } = require('../../../models');
const {
  renderInvoiceHtml,
  formatDate,
  formatIDR,
  logoAttachment,
  buildOrderStatusUrl,
} = require('./emailLayout');
const { TransactionDto } = require('../../../dtos/payments');
const { formatItemName } = require('../../../utils/merchandiseOptions');

/**
 * @typedef {import('../../../dtos/payments').TransactionDto} TransactionDto
 *
 * @typedef {Object} BuiltInvoice
 * @property {string}   to
 * @property {string}   subject
 * @property {string}   html
 * @property {Array}    attachments
 */

/**
 * @param {TransactionDto} trx
 * @returns {Promise<BuiltInvoice>}
 */
const buildTransactionInvoice = async (trx) => {
  const transactionDto = trx instanceof TransactionDto ? trx : new TransactionDto(trx);
  let merchName = transactionDto.merchandiseName;
  let price = 0;
  const [firstItem] = transactionDto.items;
  const merchandise = firstItem ? null : await Merchandises.findByPk(transactionDto.merchandiseId);
  if (firstItem) {
    // Harga & nama dari snapshot item pesanan.
    merchName = formatItemName(firstItem.merchandiseName, firstItem.selectedOptions);
    price = firstItem.unitPrice;
  } else if (merchandise) {
    merchName = formatItemName(merchandise.name, transactionDto.selectedOptions);
    // Harga satuan termasuk tambahan harga opsi yang dipilih.
    const extra = (transactionDto.selectedOptions || []).reduce((sum, s) => sum + Number(s.extraPrice || 0), 0);
    price = Number(merchandise.price) + extra;
  }
  merchName = merchName || `Merchandise #${transactionDto.merchandiseId}`;

  const invoiceCode = transactionDto.getOrderCode();
  const gross = transactionDto.getGrossAmount(price);
  const rows = transactionDto.toInvoiceRows({
    merchandiseName: merchName,
    unitPrice: formatIDR(price),
  }).map((row) => ({
    ...row,
    value: row.label === 'Tanggal' ? formatDate(row.value) : row.value,
  }));

  return {
    to: transactionDto.email,
    subject: `Invoice Pembelian ${invoiceCode} — IOM ITB`,
    html: renderInvoiceHtml({
      title: 'Invoice Pembelian',
      recipientLabel: 'pembayaran pembelian',
      recipientName: transactionDto.username,
      rows,
      grossAmount: gross,
      footer: 'Pesanan Anda akan segera diproses dan dikirim sesuai alamat di atas.',
      orderStatusUrl: buildOrderStatusUrl(transactionDto.publicToken),
    }),
    attachments: [logoAttachment()],
  };
};

module.exports = buildTransactionInvoice;
