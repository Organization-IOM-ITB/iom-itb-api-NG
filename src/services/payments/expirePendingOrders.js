const { Op } = require('sequelize');
const { Transactions, Donations, sequelize } = require('../../models');
const { releaseOrderStock } = require('../transactions/orderItems');

const DEFAULT_TTL_HOURS = 24;

const expirePendingOrders = async ({ ttlHours = DEFAULT_TTL_HOURS } = {}) => {
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

  const stats = { transactionsExpired: 0, donationsExpired: 0, stockRestored: 0 };

  const staleTrx = await Transactions.findAll({
    where: {
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      [Op.or]: [
        { expiredAt: { [Op.lt]: new Date() } },
        { expiredAt: null, createdAt: { [Op.lt]: cutoff } },
      ],
    },
    limit: 200,
  });

  for (const trx of staleTrx) {
    await sequelize.transaction(async (t) => {
      const fresh = await Transactions.findByPk(trx.id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!fresh || fresh.paymentStatus !== 'pending') return;

      const updates = {
        paymentStatus: 'expired',
        status: 'canceled',
      };

      if (fresh.stockDeducted) {
        await releaseOrderStock(fresh, t);
        updates.stockDeducted = false;
        stats.stockRestored += 1;
      }

      await fresh.update(updates, { transaction: t });
      stats.transactionsExpired += 1;
    }).catch((err) => {
      console.error(`[expirePendingOrders] failed to expire trx ${trx.id}:`, err.message);
    });
  }

  const staleDonations = await Donations.findAll({
    where: {
      paymentMethod: 'midtrans',
      paymentStatus: 'pending',
      createdAt: { [Op.lt]: cutoff },
    },
    limit: 200,
  });

  for (const don of staleDonations) {
    await sequelize.transaction(async (t) => {
      const fresh = await Donations.findByPk(don.id, {
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (!fresh || fresh.paymentStatus !== 'pending') return;

      await fresh.update({ paymentStatus: 'expired' }, { transaction: t });
      stats.donationsExpired += 1;
    }).catch((err) => {
      console.error(`[expirePendingOrders] failed to expire donation ${don.id}:`, err.message);
    });
  }

  return stats;
};

module.exports = expirePendingOrders;
