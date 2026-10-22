// Isi pesanan (keranjang): parsing input, reservasi stok, simpan item,
// pelepasan stok, dan format teks untuk notifikasi.
//
// Format input baru: items = [{ merchandiseId, qty, selectedOptions }]
// (boleh string JSON karena checkout manual memakai multipart).
// Format lama (merchandiseId + qty + selectedOptions di body) tetap diterima
// sebagai pesanan satu item.
const { Op } = require('sequelize');
const { StatusCodes } = require('http-status-codes');
const { Merchandises, TransactionItems } = require('../../models');
const BaseError = require('../../schemas/responses/BaseError');
const { resolveSelectedOptions, formatItemName } = require('../../utils/merchandiseOptions');
const { DEFAULT_ITEM_WEIGHT_GRAMS } = require('../../utils/shippingRates');

// Berat per pcs (gram) untuk ongkir.
const itemWeight = (merchandise) => (
  merchandise.weight != null ? Number(merchandise.weight) : DEFAULT_ITEM_WEIGHT_GRAMS
);

const MAX_ITEMS = 20;

const badRequest = (message) => new BaseError({ status: StatusCodes.BAD_REQUEST, message });

/**
 * @returns {Array<{ merchandiseId: number, qty: number, selectedOptions: any }>}
 * @throws {BaseError} 400
 */
const parseOrderItems = (body = {}) => {
  let raw = body.items;
  if (typeof raw === 'string') {
    try {
      raw = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      throw badRequest('Format items tidak valid.');
    }
  }

  if (raw == null) {
    if (!body.merchandiseId || body.qty == null) {
      throw badRequest('Pilih minimal satu produk (items atau merchandiseId + qty).');
    }
    raw = [{ merchandiseId: body.merchandiseId, qty: body.qty, selectedOptions: body.selectedOptions }];
  }

  if (!Array.isArray(raw) || !raw.length) throw badRequest('Keranjang masih kosong.');
  if (raw.length > MAX_ITEMS) throw badRequest(`Maksimal ${MAX_ITEMS} produk per pesanan.`);

  return raw.map((item) => {
    const merchandiseId = Number(item?.merchandiseId);
    const qty = Number(item?.qty);
    if (!Number.isInteger(merchandiseId) || merchandiseId <= 0) throw badRequest('merchandiseId tidak valid.');
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest('qty must be a positive integer');
    return { merchandiseId, qty, selectedOptions: item?.selectedOptions };
  });
};

/**
 * Kunci produk, validasi opsi, hitung harga, lalu kurangi stok — semua di
 * dalam DB transaction `t`. Bila satu produk gagal, seluruh pesanan gagal.
 * Baris dengan produk + opsi yang sama digabung.
 * @returns {Promise<{ lines: Array, subtotal: number, weightGrams: number }>}
 */
const reserveOrderItems = async (items, t) => {
  // Kunci berurutan berdasarkan id agar dua checkout bersamaan tidak deadlock.
  const ids = [...new Set(items.map((i) => i.merchandiseId))].sort((a, b) => a - b);
  const merchById = new Map();
  for (const id of ids) {
    const merchandise = await Merchandises.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!merchandise) {
      throw new BaseError({ status: StatusCodes.NOT_FOUND, message: 'Merchandise not found' });
    }
    merchById.set(id, merchandise);
  }

  const lines = [];
  for (const item of items) {
    const merchandise = merchById.get(item.merchandiseId);
    const options = resolveSelectedOptions(merchandise.options, item.selectedOptions);
    const key = JSON.stringify([merchandise.id, options.selections]);
    const existing = lines.find((l) => l.key === key);
    if (existing) {
      existing.qty += item.qty;
      continue;
    }
    lines.push({
      key,
      merchandiseId: merchandise.id,
      merchandiseName: merchandise.name,
      // Harga satuan sudah termasuk tambahan harga opsi (mis. XXL, lengan panjang).
      unitPrice: Math.round(Number(merchandise.price)) + options.extraPrice,
      unitWeight: itemWeight(merchandise),
      qty: item.qty,
      selectedOptions: options.selections,
    });
  }

  for (const id of ids) {
    const merchandise = merchById.get(id);
    const needed = lines.filter((l) => l.merchandiseId === id).reduce((sum, l) => sum + l.qty, 0);
    if (merchandise.stock < needed) {
      throw badRequest(
        merchandise.stock > 0
          ? `Stok ${merchandise.name} tidak cukup (tersisa ${merchandise.stock}).`
          : `Stok ${merchandise.name} habis.`
      );
    }
    await Merchandises.update(
      { stock: merchandise.stock - needed },
      { where: { id }, transaction: t }
    );
  }

  const cleanLines = lines.map(({ key, ...line }) => line);
  return {
    lines: cleanLines,
    subtotal: cleanLines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0),
    weightGrams: cleanLines.reduce((sum, l) => sum + l.unitWeight * l.qty, 0),
  };
};

/**
 * Perkiraan total berat (gram) tanpa mengunci stok — dipakai menghitung ongkir
 * (bisa memanggil API kurir) SEBELUM DB transaction dibuka.
 */
const estimateOrderWeight = async (items) => {
  const ids = [...new Set(items.map((i) => i.merchandiseId))];
  const found = await Merchandises.findAll({ where: { id: ids }, attributes: ['id', 'weight'] });
  const byId = new Map(found.map((m) => [m.id, m]));
  return items.reduce((sum, i) => (byId.has(i.merchandiseId) ? sum + itemWeight(byId.get(i.merchandiseId)) * i.qty : sum), 0);
};

// Kolom header Transactions = baris pertama (kompatibilitas tampilan lama).
const headerFromLines = (lines) => ({
  merchandiseId: lines[0].merchandiseId,
  qty: lines[0].qty,
  selectedOptions: lines[0].selectedOptions,
});

const saveOrderItems = (transactionId, lines, t) => TransactionItems.bulkCreate(
  lines.map((line) => ({
    transactionId,
    merchandiseId: line.merchandiseId,
    merchandiseName: line.merchandiseName,
    unitPrice: line.unitPrice,
    qty: line.qty,
    selectedOptions: line.selectedOptions,
  })),
  { transaction: t }
);

/**
 * Kembalikan stok semua item pesanan. Pesanan tanpa item (dibuat lewat
 * jalur lama) memakai kolom header.
 */
const releaseOrderStock = async (trx, t) => {
  const items = await TransactionItems.findAll({ where: { transactionId: trx.id }, transaction: t });
  const lines = items.length ? items : [{ merchandiseId: trx.merchandiseId, qty: trx.qty }];

  const qtyById = new Map();
  for (const line of lines) {
    if (!line.merchandiseId) continue;
    qtyById.set(line.merchandiseId, (qtyById.get(line.merchandiseId) || 0) + Number(line.qty || 0));
  }

  const ids = [...qtyById.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const merchandise = await Merchandises.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!merchandise) continue;
    await Merchandises.update(
      { stock: merchandise.stock + qtyById.get(id) },
      { where: { id }, transaction: t }
    );
  }
};

const toPlainItem = (item) => ({
  id: item.id,
  merchandiseId: item.merchandiseId,
  merchandiseName: item.merchandiseName,
  unitPrice: Number(item.unitPrice),
  qty: item.qty,
  selectedOptions: item.selectedOptions || null,
  merchandise: item.merchandise
    ? { id: item.merchandise.id, name: item.merchandise.name, image: item.merchandise.image }
    : null,
});

// Pesanan lama tanpa baris TransactionItems: bentuk satu item dari header.
const itemFromHeader = (trx, merchandise) => {
  const qty = Number(trx.qty || 0);
  const gross = trx.grossAmount != null ? Number(trx.grossAmount) : null;
  const unitPrice = gross != null && qty > 0
    ? (gross - Number(trx.shippingCost || 0)) / qty
    : Number(merchandise?.price || 0);
  return {
    id: null,
    merchandiseId: trx.merchandiseId,
    merchandiseName: merchandise?.name || `Merchandise #${trx.merchandiseId}`,
    unitPrice,
    qty,
    selectedOptions: trx.selectedOptions || null,
    merchandise: merchandise
      ? { id: merchandise.id, name: merchandise.name, image: merchandise.image }
      : null,
  };
};

/**
 * Isi `items` (array plain) pada setiap instance Transactions. Dipakai alih-alih
 * include hasMany supaya query daftar ber-limit/pencarian tidak berubah.
 */
const attachItems = async (transactions, t) => {
  const list = (Array.isArray(transactions) ? transactions : [transactions]).filter(Boolean);
  if (!list.length) return transactions;

  const items = await TransactionItems.findAll({
    where: { transactionId: { [Op.in]: list.map((trx) => trx.id) } },
    include: [{ model: Merchandises, as: 'merchandise', attributes: ['id', 'name', 'image'] }],
    order: [['id', 'ASC']],
    transaction: t,
  });

  const byTrx = new Map();
  for (const item of items) {
    if (!byTrx.has(item.transactionId)) byTrx.set(item.transactionId, []);
    byTrx.get(item.transactionId).push(toPlainItem(item));
  }

  const missing = list.filter((trx) => !byTrx.has(trx.id));
  const headerMerch = new Map();
  const toFetch = [...new Set(missing
    .filter((trx) => !trx.merchandises && trx.merchandiseId)
    .map((trx) => trx.merchandiseId))];
  if (toFetch.length) {
    const found = await Merchandises.findAll({ where: { id: toFetch }, transaction: t });
    found.forEach((m) => headerMerch.set(m.id, m));
  }

  for (const trx of list) {
    const value = byTrx.get(trx.id)
      || [itemFromHeader(trx, trx.merchandises || headerMerch.get(trx.merchandiseId))];
    if (typeof trx.setDataValue === 'function') trx.setDataValue('items', value);
    else trx.items = value;
  }
  return transactions;
};

const lineName = (line) => formatItemName(line.merchandiseName || line.name || 'Merchandise', line.selectedOptions);

const totalQty = (lines = []) => lines.reduce((sum, l) => sum + Number(l.qty || 0), 0);

/**
 * Teks isi pesanan untuk notifikasi.
 *  - 'text'  : satu item → "Kaos (Size: XL) x 2"; beberapa → "\n- Kaos (Size: XL) x 2\n- Mug x 1"
 *  - 'inline': "Kaos (Size: XL) x 2, Mug x 1"
 */
const formatOrderLines = (lines = [], mode = 'text') => {
  const parts = lines.map((l) => `${lineName(l)} x ${l.qty}`);
  if (mode === 'inline' || parts.length <= 1) return parts.join(', ');
  return parts.map((p) => `\n- ${p}`).join('');
};

module.exports = {
  MAX_ITEMS,
  parseOrderItems,
  reserveOrderItems,
  estimateOrderWeight,
  headerFromLines,
  saveOrderItems,
  releaseOrderStock,
  attachItems,
  lineName,
  totalQty,
  formatOrderLines,
};
