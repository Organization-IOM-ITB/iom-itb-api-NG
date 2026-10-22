const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const { quoteShipping, billableKg } = require('../../utils/shippingRates');
const {
  quoteLiveShipping,
  normalizePostalCode,
  postalCodeFromAddress,
} = require('../../utils/shippingProviders');

const UNKNOWN_ADDRESS_MESSAGE = 'Ongkir belum bisa dihitung. Isi kode pos tujuan (5 digit), '
  + 'atau lengkapi alamat sampai nama kota/kabupaten dan provinsi.';

/**
 * Ongkir untuk alamat + kode pos tujuan dan total berat (gram):
 *  1. Tarif live (RajaOngkir / AgenWebsite bergiliran) bila kode pos ada.
 *  2. Tabel zona dari teks alamat bila API tidak dikonfigurasi atau gagal.
 * @returns {Promise<object|null>} null bila tujuan tidak dikenali.
 */
const quoteOrderShipping = async ({ address, postalCode }, weightGrams) => {
  const billedKg = billableKg(weightGrams);
  const zip = normalizePostalCode(postalCode) || postalCodeFromAddress(address);
  const weight = weightGrams != null && Number.isFinite(Number(weightGrams)) ? Math.round(Number(weightGrams)) : null;

  const live = zip ? await quoteLiveShipping(zip, billedKg) : null;
  if (live) {
    return {
      zone: null,
      zoneLabel: `${live.courierName} ${live.service}`.trim(),
      cost: Math.round(live.cost),
      baseCost: null,
      extraPerKg: null,
      weightGrams: weight,
      billedKg,
      matchedPlace: live.destinationLabel || `Kode pos ${zip}`,
      byNearest: false,
      provider: live.provider,
      providerLabel: live.providerLabel,
      etd: live.etd,
      postalCode: zip,
    };
  }

  const table = quoteShipping(address, weightGrams);
  if (!table) return null;
  return { ...table, provider: 'table', providerLabel: null, etd: null, postalCode: zip };
};

// Ongkir wajib terhitung sebelum pesanan dibuat; total yang dibayar pembeli
// = Σ harga x qty + ongkir (berdasarkan total berat).
const resolveShipping = async ({ address, postalCode }, weightGrams) => {
  if (postalCode != null && String(postalCode).trim() && !normalizePostalCode(postalCode)) {
    throw new BaseError({ status: StatusCodes.BAD_REQUEST, message: 'Kode pos harus 5 digit angka.' });
  }
  const quote = await quoteOrderShipping({ address, postalCode }, weightGrams);
  if (!quote) {
    throw new BaseError({ status: StatusCodes.BAD_REQUEST, message: UNKNOWN_ADDRESS_MESSAGE });
  }
  return quote;
};

// Kolom Transactions dari hasil ongkir.
const shippingColumns = (shipping, weightGrams) => ({
  shippingCost: shipping.cost,
  shippingZone: shipping.zone,
  shippingWeight: weightGrams,
  shippingProvider: shipping.provider,
  shippingService: shipping.provider === 'table' ? null : shipping.zoneLabel,
  shippingPostalCode: shipping.postalCode,
});

// Berat bisa berubah (admin mengedit produk) antara hitung ongkir dan kunci
// stok; tolak bila kg ditagih ikut berubah agar ongkir tidak salah.
const assertSameBilledKg = (shipping, weightGrams) => {
  if (billableKg(weightGrams) !== shipping.billedKg) {
    throw new BaseError({
      status: StatusCodes.CONFLICT,
      message: 'Berat produk baru saja berubah. Silakan ulangi pesanan.',
    });
  }
};

module.exports = {
  quoteOrderShipping,
  resolveShipping,
  shippingColumns,
  assertSameBilledKg,
  UNKNOWN_ADDRESS_MESSAGE,
};
