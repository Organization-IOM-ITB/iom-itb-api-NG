const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const { quoteShipping } = require('../../utils/shippingRates');

const UNKNOWN_ADDRESS_MESSAGE = 'Kota/kabupaten pada alamat belum dikenali untuk perhitungan ongkir. '
  + 'Lengkapi alamat sampai nama kota/kabupaten dan provinsi.';

// Ongkir wajib terhitung sebelum pesanan dibuat; total yang dibayar pembeli
// = harga x qty + ongkir.
const resolveShipping = (address) => {
  const quote = quoteShipping(address);
  if (!quote) {
    throw new BaseError({ status: StatusCodes.BAD_REQUEST, message: UNKNOWN_ADDRESS_MESSAGE });
  }
  return quote;
};

module.exports = { resolveShipping, UNKNOWN_ADDRESS_MESSAGE };
