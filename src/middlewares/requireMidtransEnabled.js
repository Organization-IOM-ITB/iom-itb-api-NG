'use strict';

const { StatusCodes } = require('http-status-codes');

// Saklar sementara pembayaran online. Default MATI: Midtrans masih sandbox
// (belum berlangganan resmi), jadi transaksi baru tidak boleh dibuat sampai
// MIDTRANS_ENABLED=true di-set eksplisit. Hanya menutup pembuatan transaksi
// baru — notifikasi, verify, dan cancel tetap jalan untuk transaksi lama.
const isMidtransEnabled = () => String(process.env.MIDTRANS_ENABLED || '').toLowerCase() === 'true';

const requireMidtransEnabled = (req, res, next) => {
  if (isMidtransEnabled()) return next();

  return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
    status: StatusCodes.SERVICE_UNAVAILABLE,
    message: 'Pembayaran online sementara tidak tersedia. Silakan gunakan transfer bank manual.',
  });
};

module.exports = requireMidtransEnabled;
module.exports.isMidtransEnabled = isMidtransEnabled;
