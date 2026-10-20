const { formatItemName } = require('../utils/merchandiseOptions');

const orderStatusLabels = {
  waiting: 'Menunggu diproses',
  'on process': 'Diproses',
  'on delivery': 'Dikirim',
  arrived: 'Tiba',
  done: 'Selesai',
  canceled: 'Dibatalkan',
  denied: 'Ditolak',
};

/**
 * @typedef {'donation-paid' | 'merchandise-paid'} PaymentNotificationKind
 * @typedef {'emerald' | 'blue' | 'amber'} PaymentNotificationTone
 *
 * @typedef {Object} PaymentNotificationItem
 * @property {string} id
 * @property {PaymentNotificationKind} kind
 * @property {PaymentNotificationTone} tone
 * @property {string} title
 * @property {string} subject
 * @property {string} description
 * @property {string} route
 * @property {string | null | undefined} amountLabel
 * @property {Date | string | null} timestamp
 * @property {string} relativeTime
 * @property {boolean} read
 */

const formatCurrency = (value) => {
  if (value == null || value === '') return null;

  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);

  return `Rp ${amount.toLocaleString('id-ID')}`;
};

const formatDonationType = (value) => {
  if (!value) return 'Donasi';

  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const formatRelativeTime = (value) => {
  const time = value ? new Date(value).getTime() : 0;
  if (!time || Number.isNaN(time)) return 'Baru';

  const diff = Date.now() - time;
  if (diff < 60_000) return 'Baru';

  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} menit lalu`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;

  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(time));
};

const getPaymentTimestamp = (record) => {
  return record?.paidAt || record?.updatedAt || record?.date || record?.createdAt || null;
};

const getTimestampValue = (value) => {
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const isRead = (record, lastReadAt) => {
  return getTimestampValue(getPaymentTimestamp(record)) <= getTimestampValue(lastReadAt);
};

/**
 * @param {import('../models').Donations} donation
 * @param {Map<number, { id: number, name: string }>} facultiesById
 * @param {Date} lastReadAt
 * @returns {PaymentNotificationItem}
 */
const toDonationNotification = (donation, facultiesById, lastReadAt) => {
  const timestamp = getPaymentTimestamp(donation);
  const faculty = donation.facultyId ? facultiesById.get(donation.facultyId) : null;
  const facultyName = faculty?.name ? `Fakultas ${faculty.name}` : 'Tanpa fakultas';

  return {
    id: `donation-${donation.id}`,
    kind: 'donation-paid',
    tone: 'emerald',
    title: 'Donasi Midtrans lunas',
    subject: donation.name || 'Donatur',
    description: `${formatDonationType(donation.donationType)} · ${facultyName}`,
    route: '/donasi',
    amountLabel: formatCurrency(donation.grossAmount || donation.amount),
    timestamp,
    relativeTime: formatRelativeTime(timestamp),
    read: isRead(donation, lastReadAt),
  };
};

/**
 * @param {import('../models').Transactions} transaction
 * @param {Date} lastReadAt
 * @returns {PaymentNotificationItem}
 */
const toTransactionNotification = (transaction, lastReadAt) => {
  const timestamp = getPaymentTimestamp(transaction);
  const merchandiseName = formatItemName(
    transaction.merchandises?.name || `Merchandise #${transaction.merchandiseId || '-'}`,
    transaction.selectedOptions
  );
  const statusLabel = orderStatusLabels[transaction.status] || transaction.status || 'Status belum jelas';
  const qtyLabel = transaction.qty ? ` x${transaction.qty}` : '';

  return {
    id: `transaction-${transaction.id}`,
    kind: 'merchandise-paid',
    tone: transaction.status === 'waiting' ? 'amber' : 'blue',
    title: 'Merchandise dibayar',
    subject: transaction.username || transaction.email || transaction.code || 'Pembeli',
    description: `${merchandiseName}${qtyLabel} · ${statusLabel}`,
    route: '/transactions',
    amountLabel: formatCurrency(transaction.grossAmount),
    timestamp,
    relativeTime: formatRelativeTime(timestamp),
    read: isRead(transaction, lastReadAt),
  };
};

const comparePaymentNotificationsByTime = (left, right) => {
  return getTimestampValue(right.timestamp) - getTimestampValue(left.timestamp);
};

module.exports = {
  comparePaymentNotificationsByTime,
  toDonationNotification,
  toTransactionNotification,
};

