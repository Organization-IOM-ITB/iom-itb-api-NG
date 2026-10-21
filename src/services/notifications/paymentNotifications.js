const { Op } = require('sequelize');
const {
  Donations,
  Faculties,
  Merchandises,
  PaymentNotificationReads,
  Transactions,
} = require('../../models');
const { attachItems } = require('../transactions/orderItems');
const {
  comparePaymentNotificationsByTime,
  toDonationNotification,
  toTransactionNotification,
} = require('../../dtos/paymentNotifications');

const NOTIFICATION_LIMIT = 6;
const SOURCE_LIMIT = 5;

/**
 * @typedef {Object} AuthenticatedUser
 * @property {string=} sub
 * @property {string=} email
 * @property {string=} preferred_username
 *
 * @typedef {Object} PaymentNotificationSummary
 * @property {number} donationCount
 * @property {number} merchandiseCount
 *
 * @typedef {Object} PaymentNotificationSourceResult
 * @property {Array<Object>} donations
 * @property {Array<Object>} transactions
 *
 * @typedef {Object} PaymentNotificationListResult
 * @property {Array<import('../../dtos/paymentNotifications').PaymentNotificationItem>} items
 * @property {PaymentNotificationSummary} summary
 * @property {number} unreadCount
 * @property {Date} lastReadAt
 *
 * @typedef {Object} MarkPaymentNotificationsReadResult
 * @property {Date} lastReadAt
 * @property {number} unreadCount
 */

/**
 * @param {AuthenticatedUser} user
 * @returns {string}
 */
const userKeyFromUser = (user = {}) => {
  return user.sub || user.email || user.preferred_username || 'unknown';
};

/**
 * @param {AuthenticatedUser} user
 * @returns {Promise<import('../../models').PaymentNotificationReads>}
 */
const readStateForUser = async (user) => {
  const userKey = userKeyFromUser(user);
  const [readState] = await PaymentNotificationReads.findOrCreate({
    where: { userKey },
    defaults: { userKey, lastReadAt: new Date() },
  });

  return readState;
};

/**
 * @param {Date=} lastReadAt
 * @returns {Object}
 */
const getPaidDonationWhere = (lastReadAt) => ({
  paymentMethod: 'midtrans',
  paymentStatus: 'settlement',
  ...(lastReadAt ? { updatedAt: { [Op.gt]: lastReadAt } } : {}),
});

/**
 * @param {Date=} lastReadAt
 * @returns {Object}
 */
const getPaidTransactionWhere = (lastReadAt) => ({
  paymentMethod: 'midtrans',
  paymentStatus: 'settlement',
  ...(lastReadAt ? { updatedAt: { [Op.gt]: lastReadAt } } : {}),
});

/**
 * @returns {Promise<PaymentNotificationSourceResult>}
 */
const fetchRecentSources = async () => {
  const [donations, transactions] = await Promise.all([
    Donations.findAll({
      where: getPaidDonationWhere(),
      order: [['updatedAt', 'DESC']],
      limit: SOURCE_LIMIT,
      raw: true,
    }),
    Transactions.findAll({
      where: getPaidTransactionWhere(),
      include: [{ model: Merchandises, as: 'merchandises', attributes: ['id', 'name'] }],
      order: [['updatedAt', 'DESC']],
      limit: SOURCE_LIMIT,
    }),
  ]);

  await attachItems(transactions);
  return { donations, transactions };
};

/**
 * @param {Date} lastReadAt
 * @returns {Promise<number>}
 */
const getUnreadCount = async (lastReadAt) => {
  const [donationCount, transactionCount] = await Promise.all([
    Donations.count({ where: getPaidDonationWhere(lastReadAt) }),
    Transactions.count({ where: getPaidTransactionWhere(lastReadAt) }),
  ]);

  return donationCount + transactionCount;
};

/**
 * @returns {Promise<PaymentNotificationSummary>}
 */
const getSummary = async () => {
  const [donationCount, merchandiseCount] = await Promise.all([
    Donations.count({ where: getPaidDonationWhere() }),
    Transactions.count({ where: getPaidTransactionWhere() }),
  ]);

  return { donationCount, merchandiseCount };
};

/**
 * @param {Array<Object>} donations
 * @returns {Promise<Map<number, { id: number, name: string }>>}
 */
const getFacultiesById = async (donations) => {
  const facultyIds = [...new Set(donations.map((donation) => donation.facultyId).filter(Boolean))];
  if (!facultyIds.length) return new Map();

  const faculties = await Faculties.findAll({
    where: { id: facultyIds },
    attributes: ['id', 'name'],
    raw: true,
  });

  return new Map(faculties.map((faculty) => [faculty.id, faculty]));
};

/**
 * @param {AuthenticatedUser} user
 * @returns {Promise<PaymentNotificationListResult>}
 */
const getPaymentNotifications = async (user) => {
  const readState = await readStateForUser(user);
  const lastReadAt = readState.lastReadAt;
  const [{ donations, transactions }, summary, unreadCount] = await Promise.all([
    fetchRecentSources(),
    getSummary(),
    getUnreadCount(lastReadAt),
  ]);
  const facultiesById = await getFacultiesById(donations);

  const items = [
    ...donations.map((donation) => toDonationNotification(donation, facultiesById, lastReadAt)),
    ...transactions.map((transaction) => toTransactionNotification(transaction, lastReadAt)),
  ]
    .sort(comparePaymentNotificationsByTime)
    .slice(0, NOTIFICATION_LIMIT);

  return {
    items,
    summary,
    unreadCount,
    lastReadAt,
  };
};

/**
 * @param {AuthenticatedUser} user
 * @returns {Promise<MarkPaymentNotificationsReadResult>}
 */
const markPaymentNotificationsRead = async (user) => {
  const readState = await readStateForUser(user);
  const dbNow = require('sequelize').fn('NOW');

  await readState.update({ lastReadAt: dbNow });

  // Return a new date for immediate frontend consumption
  return {
    lastReadAt: new Date(),
    unreadCount: 0,
  };
};

module.exports = {
  getPaymentNotifications,
  markPaymentNotificationsRead,
};
