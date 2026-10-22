// Tarif ongkir live dari API gratis RajaOngkir (Komerce) dan AgenWebsite,
// dipakai bergiliran (round-robin) agar kuota harian gratis keduanya terbagi:
//   - RajaOngkir Starter: ±100 hit/hari (cari tujuan + hitung = 2 hit, id
//     tujuan per kode pos di-cache sehingga berikutnya cukup 1 hit).
//   - AgenWebsite Free: 150 request/hari, 20/menit.
// Provider yang gagal (timeout, kuota habis, tujuan tidak ditemukan) dilewati
// ke provider berikutnya. Bila semua gagal, pemanggil memakai tabel zona
// (utils/shippingRates.js).
//
// Tujuan & asal memakai KODE POS. Berat yang dikirim = kg ditagih × 1000
// sehingga harga konsisten dengan "N kg" yang ditampilkan.
//
// Env (nilai rahasia tidak pernah di-log):
//   RAJAONGKIR_API_KEY, AGENWEBSITE_API_KEY  — provider tanpa key dilewati
//   SHIPPING_ORIGIN_POSTAL_CODE              — default 40132 (ITB, Bandung)
//   SHIPPING_COURIERS                        — default "jnt"; pisahkan dengan koma
//   RAJAONGKIR_ORIGIN_ID                     — opsional, lewati pencarian asal
const RAJAONGKIR_BASE_URL = 'https://rajaongkir.komerce.id/api/v1';
const AGENWEBSITE_BASE_URL = 'https://api.agenwebsite.com/v1';
const REQUEST_TIMEOUT_MS = 8000;
const QUOTE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const QUOTE_CACHE_MAX = 500;
const DESTINATION_CACHE_MAX = 2000;
const POSTAL_CODE_PATTERN = /^\d{5}$/;
// Layanan kargo/trucking punya minimal berat & alur drop-off berbeda.
const EXCLUDED_SERVICE_PATTERN = /cargo|kargo|trucking|jtr/i;

class ProviderError extends Error {
  constructor(provider, code, message) {
    super(message || code);
    this.provider = provider;
    this.code = code;
  }
}

const originPostalCode = () => String(process.env.SHIPPING_ORIGIN_POSTAL_CODE || '40132').trim();

const couriers = () => String(process.env.SHIPPING_COURIERS || 'jnt')
  .split(',')
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

const normalizePostalCode = (value) => {
  const code = String(value ?? '').trim();
  return POSTAL_CODE_PATTERN.test(code) ? code : null;
};

// Kode pos 5 digit terakhir yang disebut di teks alamat.
const postalCodeFromAddress = (address) => {
  const matches = String(address || '').match(/\b\d{5}\b/g);
  return matches ? matches[matches.length - 1] : null;
};

const requestJson = async (provider, url, options) => {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderError(provider, err.name === 'TimeoutError' ? 'timeout' : 'network_error');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // body bukan JSON — ditangani di bawah
  }
  if (!res.ok) {
    const code = body?.error?.code || body?.meta?.message || `http_${res.status}`;
    throw new ProviderError(provider, String(code).slice(0, 120), `HTTP ${res.status}`);
  }
  return body;
};

const pickCheapest = (provider, rates) => {
  const usable = rates.filter((r) => Number(r.cost) > 0 && !EXCLUDED_SERVICE_PATTERN.test(`${r.courierName} ${r.service}`));
  if (!usable.length) throw new ProviderError(provider, 'no_rates');
  return usable.reduce((best, r) => (Number(r.cost) < Number(best.cost) ? r : best));
};

// --- RajaOngkir (Komerce) -------------------------------------------------

const rajaOngkirDestinations = new Map(); // kode pos → { id, label }

const rajaOngkirHeaders = () => ({ key: process.env.RAJAONGKIR_API_KEY });

const rajaOngkirDestination = async (postalCode) => {
  if (rajaOngkirDestinations.has(postalCode)) return rajaOngkirDestinations.get(postalCode);
  const url = `${RAJAONGKIR_BASE_URL}/destination/domestic-destination?search=${encodeURIComponent(postalCode)}&limit=50&offset=0`;
  const body = await requestJson('rajaongkir', url, { headers: rajaOngkirHeaders() });
  const match = (Array.isArray(body?.data) ? body.data : [])
    .find((d) => String(d.zip_code || '').trim() === postalCode);
  if (!match) throw new ProviderError('rajaongkir', 'destination_not_found');
  const destination = { id: match.id, label: match.label || null };
  if (rajaOngkirDestinations.size >= DESTINATION_CACHE_MAX) rajaOngkirDestinations.clear();
  rajaOngkirDestinations.set(postalCode, destination);
  return destination;
};

const rajaOngkir = {
  name: 'rajaongkir',
  label: 'RajaOngkir',
  configured: () => Boolean(process.env.RAJAONGKIR_API_KEY),
  async quote(postalCode, weightGrams) {
    const originId = process.env.RAJAONGKIR_ORIGIN_ID
      || (await rajaOngkirDestination(originPostalCode())).id;
    const destination = await rajaOngkirDestination(postalCode);
    const form = new URLSearchParams({
      origin: String(originId),
      destination: String(destination.id),
      weight: String(weightGrams),
      courier: couriers().join(':'),
      price: 'lowest',
    });
    const body = await requestJson('rajaongkir', `${RAJAONGKIR_BASE_URL}/calculate/domestic-cost`, {
      method: 'POST',
      headers: { ...rajaOngkirHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const rates = (Array.isArray(body?.data) ? body.data : []).map((r) => ({
      courierName: r.name || String(r.code || '').toUpperCase(),
      service: r.service || '',
      cost: Number(r.cost),
      etd: r.etd || null,
    }));
    return { ...pickCheapest('rajaongkir', rates), destinationLabel: destination.label };
  },
};

// --- AgenWebsite ------------------------------------------------------------

const agenWebsite = {
  name: 'agenwebsite',
  label: 'AgenWebsite',
  configured: () => Boolean(process.env.AGENWEBSITE_API_KEY),
  async quote(postalCode, weightGrams) {
    const body = await requestJson('agenwebsite', `${AGENWEBSITE_BASE_URL}/rates`, {
      method: 'POST',
      headers: { 'x-api-key': process.env.AGENWEBSITE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shipper: { zipcode: originPostalCode() },
        destination: { zipcode: postalCode },
        weight: weightGrams,
        couriers: couriers(),
        sort: 'cheapest',
      }),
    });
    const rates = (Array.isArray(body?.data?.rates) ? body.data.rates : []).map((r) => ({
      courierName: r.courier_name || String(r.courier_code || '').toUpperCase(),
      service: r.service_name || r.service_code || '',
      // `cost` = tarif kurir; discounted_cost hanya berlaku bila kirim lewat AgenWebsite.
      cost: Number(r.cost),
      etd: r.etd_text || null,
    }));
    return { ...pickCheapest('agenwebsite', rates), destinationLabel: null };
  },
};

// --- Round-robin + cache ------------------------------------------------------

const PROVIDERS = [rajaOngkir, agenWebsite];
let nextProvider = 0;
const quoteCache = new Map(); // `${kodePos}:${kg}` → { expiresAt, quote }

const liveShippingEnabled = () => PROVIDERS.some((p) => p.configured());

/**
 * Tarif live termurah untuk kode pos tujuan & kg ditagih.
 * @returns {Promise<null | { provider, providerLabel, courierName, service, cost, etd, destinationLabel }>}
 *   null bila tidak ada provider yang dikonfigurasi atau semuanya gagal.
 */
const quoteLiveShipping = async (postalCode, billedKg) => {
  const configured = PROVIDERS.filter((p) => p.configured());
  if (!configured.length || !normalizePostalCode(postalCode)) return null;

  const key = `${postalCode}:${billedKg}`;
  const cached = quoteCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.quote;

  const start = nextProvider % configured.length;
  nextProvider = (nextProvider + 1) % configured.length;
  for (let i = 0; i < configured.length; i += 1) {
    const provider = configured[(start + i) % configured.length];
    try {
      const rate = await provider.quote(postalCode, billedKg * 1000);
      const quote = { provider: provider.name, providerLabel: provider.label, ...rate };
      if (quoteCache.size >= QUOTE_CACHE_MAX) quoteCache.delete(quoteCache.keys().next().value);
      quoteCache.set(key, { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, quote });
      return quote;
    } catch (err) {
      console.warn(`[ongkir] ${provider.name} gagal untuk ${postalCode}/${billedKg}kg: ${err.code || err.message}`);
    }
  }
  return null;
};

// Untuk test.
const resetShippingProviderState = () => {
  nextProvider = 0;
  quoteCache.clear();
  rajaOngkirDestinations.clear();
};

module.exports = {
  liveShippingEnabled,
  quoteLiveShipping,
  normalizePostalCode,
  postalCodeFromAddress,
  resetShippingProviderState,
};
