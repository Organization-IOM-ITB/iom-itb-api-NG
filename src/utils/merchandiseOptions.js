// Opsi produk merchandise (mis. Warna, Lengan, Size) dan pilihan pembeli.
//
// Definisi di Merchandises.options:
//   [{ name: 'Size', values: [{ label: 'XL', extraPrice: 0 }, { label: 'XXL', extraPrice: 1500 }] }]
// Pilihan pembeli disalin ke Transactions.selectedOptions (snapshot, agar
// riwayat pesanan tetap benar walau opsi produk diubah kemudian):
//   [{ name: 'Size', value: 'XXL', extraPrice: 1500 }]
// Harga satuan = harga produk + jumlah extraPrice pilihan.

const MAX_GROUPS = 6;
const MAX_VALUES = 40;
const MAX_TEXT = 60;

// status 400 → diteruskan apa adanya oleh blok catch service (error.status).
class OptionError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const parseJson = (input, what) => {
  if (typeof input !== 'string') return input;
  if (!input.trim()) return null;
  try {
    return JSON.parse(input);
  } catch {
    throw new OptionError(`${what} bukan JSON yang valid.`);
  }
};

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/**
 * Validasi & rapikan definisi opsi dari form admin.
 * @returns {Array|null} null bila tidak ada opsi.
 * @throws {OptionError}
 */
const normalizeOptionsDefinition = (input) => {
  const raw = parseJson(input, 'Opsi produk');
  if (raw == null) return null;
  if (!Array.isArray(raw)) throw new OptionError('Opsi produk harus berupa daftar.');

  const groups = [];
  const groupNames = new Set();
  for (const group of raw) {
    const name = cleanText(group?.name);
    const values = [];
    const labels = new Set();
    for (const value of Array.isArray(group?.values) ? group.values : []) {
      const label = cleanText(value?.label);
      if (!label) continue;
      const key = label.toLowerCase();
      if (labels.has(key)) throw new OptionError(`Pilihan "${label}" pada opsi "${name}" ganda.`);
      const extraPrice = Number(value?.extraPrice || 0);
      if (!Number.isInteger(extraPrice) || extraPrice < 0) {
        throw new OptionError(`Tambahan harga "${label}" pada opsi "${name}" harus bilangan bulat ≥ 0.`);
      }
      labels.add(key);
      values.push({ label, extraPrice });
    }
    if (!name && !values.length) continue;
    if (!name) throw new OptionError('Nama opsi wajib diisi.');
    if (!values.length) throw new OptionError(`Opsi "${name}" belum punya pilihan.`);
    if (values.length > MAX_VALUES) throw new OptionError(`Opsi "${name}" maksimal ${MAX_VALUES} pilihan.`);
    if (groupNames.has(name.toLowerCase())) throw new OptionError(`Nama opsi "${name}" ganda.`);
    groupNames.add(name.toLowerCase());
    groups.push({ name, values });
  }
  if (groups.length > MAX_GROUPS) throw new OptionError(`Maksimal ${MAX_GROUPS} opsi per produk.`);
  return groups.length ? groups : null;
};

/**
 * Cocokkan pilihan pembeli ({ Warna: 'Navy', ... }, boleh string JSON)
 * dengan definisi opsi produk. Semua opsi wajib dipilih.
 * @returns {{ selections: Array|null, extraPrice: number }}
 * @throws {OptionError}
 */
const resolveSelectedOptions = (definition, input) => {
  const groups = Array.isArray(definition) ? definition : [];
  if (!groups.length) return { selections: null, extraPrice: 0 };

  const chosen = parseJson(input, 'Pilihan opsi') || {};
  if (typeof chosen !== 'object' || Array.isArray(chosen)) {
    throw new OptionError('Pilihan opsi tidak valid.');
  }

  const selections = groups.map((group) => {
    const picked = cleanText(chosen[group.name]);
    if (!picked) throw new OptionError(`Pilih ${group.name} terlebih dahulu.`);
    const value = group.values.find((v) => v.label.toLowerCase() === picked.toLowerCase());
    if (!value) throw new OptionError(`Pilihan ${group.name} "${picked}" tidak tersedia.`);
    return { name: group.name, value: value.label, extraPrice: Number(value.extraPrice || 0) };
  });

  return {
    selections,
    extraPrice: selections.reduce((sum, s) => sum + s.extraPrice, 0),
  };
};

const parseStored = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// "Warna: Navy, Lengan: Panjang, Size: XL" — kosong bila tanpa opsi.
const describeSelectedOptions = (selectedOptions) => {
  const list = parseStored(selectedOptions);
  if (!Array.isArray(list) || !list.length) return '';
  return list.map((s) => `${s.name}: ${s.value}`).join(', ');
};

// Nama item untuk notifikasi/invoice: "Kaos IOM (Warna: Navy, Size: XL)".
const formatItemName = (merchandiseName, selectedOptions) => {
  const desc = describeSelectedOptions(selectedOptions);
  return desc ? `${merchandiseName} (${desc})` : merchandiseName;
};

module.exports = {
  OptionError,
  normalizeOptionsDefinition,
  resolveSelectedOptions,
  describeSelectedOptions,
  formatItemName,
  parseStored,
};
