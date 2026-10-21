// Berat produk (gram per pcs, termasuk kemasan) dari form admin.
const MAX_WEIGHT_GRAMS = 30000;

class WeightError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * @returns {number|null} null bila dikosongkan (ongkir memakai berat default).
 * @throws {WeightError}
 */
const normalizeWeight = (input) => {
  if (input === undefined || input === null || String(input).trim() === '') return null;
  const grams = Number(input);
  if (!Number.isInteger(grams) || grams < 1 || grams > MAX_WEIGHT_GRAMS) {
    throw new WeightError(`Berat harus bilangan bulat 1–${MAX_WEIGHT_GRAMS} gram.`);
  }
  return grams;
};

module.exports = { normalizeWeight, WeightError };
