// Ongkos kirim merchandise: per wilayah tujuan, berdasarkan berat pesanan.
//
// Ongkir = tarif 1 kg pertama (`cost`) + (kg ditagih − 1) × `extraPerKg`.
// Kg ditagih = total berat (Σ berat produk × qty, gram, sudah termasuk
// kemasan) dibulatkan ke atas bila sisa > 300 g, minimal 1 kg — mengikuti
// aturan umum kurir reguler (JNE/J&T). Tarif per kg berikutnya sama dengan kg
// pertama karena tarif kurir reguler linear per kg.
//
// Wilayah ditentukan dari teks alamat pembeli:
// 1. Cari nama kota/kabupaten/provinsi yang dikenal di alamat. Alamat ditulis
//    dari jalan → kota → provinsi, jadi nama yang muncul PALING AKHIR dipakai
//    (mis. "Jl. Jakarta No. 5, Bandung" → Bandung). Kalau yang terakhir nama
//    provinsi, kota dari provinsi yang sama yang juga disebut lebih diutamakan.
// 2. Tempat yang masuk daftar tarif langsung memakai tarif wilayahnya.
// 3. Tempat di luar daftar memakai tarif wilayah TERDEKAT (jarak garis lurus
//    dari koordinat ibu kota/kotanya ke titik acuan tiap wilayah).
//
// Tabel tarif: SHIPPING_ZONES. Ubah di sini kalau tarif berubah.

// Berat produk yang belum diisi admin.
const DEFAULT_ITEM_WEIGHT_GRAMS = 500;
// Sisa berat di atas kg bulat yang masih dibulatkan ke bawah.
const WEIGHT_TOLERANCE_GRAMS = 300;

const SHIPPING_ZONES = {
  bandung: {
    label: 'Bandung',
    cost: 10000,
    extraPerKg: 10000,
    anchors: [[-6.917, 107.619]],
  },
  jabodetabek: {
    label: 'Jabodetabek dan sekitarnya',
    cost: 15000,
    extraPerKg: 15000,
    anchors: [[-6.2, 106.817]],
  },
  priangan_timur: {
    label: 'Garut, Tasikmalaya, Priangan Timur',
    cost: 15000,
    extraPerKg: 15000,
    anchors: [[-7.327, 108.22], [-7.217, 107.9]],
  },
  jateng_jatim: {
    label: 'Jawa Tengah dan Jawa Timur',
    cost: 25000,
    extraPerKg: 25000,
    anchors: [[-6.99, 110.42], [-7.566, 110.817], [-7.25, 112.75]],
  },
  sumsel: {
    label: 'Sumatera Selatan',
    cost: 25000,
    extraPerKg: 25000,
    anchors: [[-2.976, 104.775]],
  },
  sumut: {
    label: 'Sumatera Utara',
    cost: 70000,
    extraPerKg: 70000,
    anchors: [[3.595, 98.672]],
  },
  balikpapan: {
    label: 'Balikpapan',
    cost: 60000,
    extraPerKg: 60000,
    anchors: [[-1.265, 116.831]],
  },
  batam: {
    label: 'Batam',
    cost: 45000,
    extraPerKg: 45000,
    anchors: [[1.045, 104.03]],
  },
  aceh: {
    label: 'Aceh',
    cost: 70000,
    extraPerKg: 70000,
    anchors: [[5.55, 95.317]],
  },
  palu: {
    label: 'Palu',
    cost: 90000,
    extraPerKg: 90000,
    anchors: [[-0.9, 119.87]],
  },
};

// Provinsi: `zone` = semua tempat di provinsi itu masuk wilayah tarif tsb;
// `at` = koordinat ibu kota untuk mencari wilayah terdekat. Provinsi tanpa
// keduanya (Jawa Barat) terlalu beragam tarifnya — kota wajib disebut.
// Kota: `zone` eksplisit, `at` koordinat sendiri, atau ikut provinsinya.
const PROVINCES = [
  {
    name: 'DKI Jakarta',
    keys: ['dki jakarta', 'dki', 'jakarta', 'jakarta pusat', 'jakarta utara', 'jakarta barat', 'jakarta selatan', 'jakarta timur'],
    zone: 'jabodetabek',
    cities: [
      { name: 'Kepulauan Seribu', keys: ['kepulauan seribu'] },
    ],
  },
  {
    name: 'Banten',
    keys: ['banten'],
    zone: 'jabodetabek',
    cities: [
      { name: 'Tangerang', keys: ['tangerang', 'tangerang selatan', 'tangsel', 'serpong', 'bsd', 'ciputat', 'pamulang', 'bintaro', 'cikupa', 'balaraja'] },
      { name: 'Serang', keys: ['serang'] },
      { name: 'Cilegon', keys: ['cilegon'] },
      { name: 'Pandeglang', keys: ['pandeglang'] },
      { name: 'Lebak', keys: ['lebak', 'rangkasbitung'] },
    ],
  },
  {
    name: 'Jawa Barat',
    keys: ['jawa barat', 'jabar'],
    cities: [
      { name: 'Bandung Raya', keys: ['bandung', 'bandung barat', 'kbb', 'cimahi', 'jatinangor', 'lembang', 'soreang', 'padalarang', 'cileunyi', 'rancaekek', 'majalaya', 'banjaran', 'baleendah', 'dayeuhkolot', 'ngamprah'], zone: 'bandung' },
      { name: 'Bogor', keys: ['bogor', 'cibinong', 'cileungsi', 'gunung putri'], zone: 'jabodetabek' },
      { name: 'Depok', keys: ['depok'], zone: 'jabodetabek' },
      { name: 'Bekasi', keys: ['bekasi', 'cikarang', 'tambun'], zone: 'jabodetabek' },
      { name: 'Karawang', keys: ['karawang'], zone: 'jabodetabek' },
      { name: 'Purwakarta', keys: ['purwakarta'], zone: 'jabodetabek' },
      { name: 'Garut', keys: ['garut'], zone: 'priangan_timur' },
      { name: 'Tasikmalaya', keys: ['tasikmalaya', 'tasik'], zone: 'priangan_timur' },
      { name: 'Ciamis', keys: ['ciamis'], zone: 'priangan_timur' },
      { name: 'Banjar', keys: ['kota banjar'], zone: 'priangan_timur' },
      { name: 'Pangandaran', keys: ['pangandaran'], zone: 'priangan_timur' },
      { name: 'Sukabumi', keys: ['sukabumi', 'pelabuhan ratu', 'palabuhanratu'], at: [-6.921, 106.927] },
      { name: 'Cianjur', keys: ['cianjur'], at: [-6.817, 107.137] },
      { name: 'Sumedang', keys: ['sumedang'], at: [-6.858, 107.92] },
      { name: 'Subang', keys: ['subang'], at: [-6.571, 107.761] },
      { name: 'Indramayu', keys: ['indramayu'], at: [-6.327, 108.32] },
      { name: 'Majalengka', keys: ['majalengka'], at: [-6.836, 108.227] },
      { name: 'Kuningan', keys: ['kuningan'], at: [-6.976, 108.483] },
      { name: 'Cirebon', keys: ['cirebon'], at: [-6.732, 108.552] },
    ],
  },
  {
    name: 'Jawa Tengah',
    keys: ['jawa tengah', 'jateng'],
    zone: 'jateng_jatim',
    cities: [
      { name: 'Semarang', keys: ['semarang', 'ungaran'] },
      { name: 'Surakarta', keys: ['surakarta', 'solo'] },
      { name: 'Salatiga', keys: ['salatiga'] },
      { name: 'Magelang', keys: ['magelang'] },
      { name: 'Pekalongan', keys: ['pekalongan'] },
      { name: 'Tegal', keys: ['tegal', 'slawi'] },
      { name: 'Banyumas', keys: ['banyumas', 'purwokerto'] },
      { name: 'Cilacap', keys: ['cilacap'] },
      { name: 'Kudus', keys: ['kudus'] },
      { name: 'Jepara', keys: ['jepara'] },
      { name: 'Pati', keys: ['pati'] },
      { name: 'Klaten', keys: ['klaten'] },
      { name: 'Boyolali', keys: ['boyolali'] },
      { name: 'Sukoharjo', keys: ['sukoharjo'] },
      { name: 'Karanganyar', keys: ['karanganyar'] },
      { name: 'Sragen', keys: ['sragen'] },
      { name: 'Wonogiri', keys: ['wonogiri'] },
      { name: 'Kebumen', keys: ['kebumen'] },
      { name: 'Purworejo', keys: ['purworejo'] },
      { name: 'Wonosobo', keys: ['wonosobo'] },
      { name: 'Temanggung', keys: ['temanggung'] },
      { name: 'Kendal', keys: ['kendal'] },
      { name: 'Demak', keys: ['demak'] },
      { name: 'Rembang', keys: ['rembang'] },
      { name: 'Blora', keys: ['blora'] },
      { name: 'Grobogan', keys: ['grobogan', 'purwodadi'] },
      { name: 'Brebes', keys: ['brebes'] },
      { name: 'Pemalang', keys: ['pemalang'] },
      { name: 'Batang', keys: ['kabupaten batang', 'kab batang'] },
      { name: 'Banjarnegara', keys: ['banjarnegara'] },
      { name: 'Purbalingga', keys: ['purbalingga'] },
    ],
  },
  {
    name: 'Jawa Timur',
    keys: ['jawa timur', 'jatim'],
    zone: 'jateng_jatim',
    cities: [
      { name: 'Surabaya', keys: ['surabaya'] },
      { name: 'Malang', keys: ['malang'] },
      { name: 'Batu', keys: ['kota batu'] },
      { name: 'Sidoarjo', keys: ['sidoarjo'] },
      { name: 'Gresik', keys: ['gresik'] },
      { name: 'Mojokerto', keys: ['mojokerto'] },
      { name: 'Kediri', keys: ['kediri'] },
      { name: 'Blitar', keys: ['blitar'] },
      { name: 'Madiun', keys: ['madiun'] },
      { name: 'Jember', keys: ['jember'] },
      { name: 'Banyuwangi', keys: ['banyuwangi'] },
      { name: 'Probolinggo', keys: ['probolinggo'] },
      { name: 'Pasuruan', keys: ['pasuruan'] },
      { name: 'Lamongan', keys: ['lamongan'] },
      { name: 'Tuban', keys: ['tuban'] },
      { name: 'Bojonegoro', keys: ['bojonegoro'] },
      { name: 'Ngawi', keys: ['ngawi'] },
      { name: 'Ponorogo', keys: ['ponorogo'] },
      { name: 'Pacitan', keys: ['pacitan'] },
      { name: 'Trenggalek', keys: ['trenggalek'] },
      { name: 'Tulungagung', keys: ['tulungagung'] },
      { name: 'Nganjuk', keys: ['nganjuk'] },
      { name: 'Jombang', keys: ['jombang'] },
      { name: 'Lumajang', keys: ['lumajang'] },
      { name: 'Bondowoso', keys: ['bondowoso'] },
      { name: 'Situbondo', keys: ['situbondo'] },
      { name: 'Magetan', keys: ['magetan'] },
      { name: 'Madura', keys: ['madura', 'bangkalan', 'sampang', 'pamekasan', 'sumenep'] },
    ],
  },
  {
    name: 'DI Yogyakarta',
    keys: ['yogyakarta', 'jogjakarta', 'jogja', 'yogya', 'diy'],
    at: [-7.797, 110.37],
    cities: [
      { name: 'Sleman', keys: ['sleman'] },
      { name: 'Bantul', keys: ['bantul'] },
      { name: 'Kulon Progo', keys: ['kulon progo', 'kulonprogo'] },
      { name: 'Gunungkidul', keys: ['gunungkidul', 'gunung kidul', 'wonosari'] },
    ],
  },
  {
    name: 'Aceh',
    keys: ['aceh', 'nanggroe aceh darussalam', 'nad'],
    zone: 'aceh',
    cities: [
      { name: 'Banda Aceh', keys: ['banda aceh'] },
      { name: 'Lhokseumawe', keys: ['lhokseumawe'] },
      { name: 'Langsa', keys: ['langsa'] },
      { name: 'Meulaboh', keys: ['meulaboh'] },
      { name: 'Sabang', keys: ['sabang'] },
      { name: 'Takengon', keys: ['takengon'] },
    ],
  },
  {
    name: 'Sumatera Utara',
    keys: ['sumatera utara', 'sumatra utara', 'sumut'],
    zone: 'sumut',
    cities: [
      { name: 'Medan', keys: ['medan'] },
      { name: 'Binjai', keys: ['binjai'] },
      { name: 'Pematangsiantar', keys: ['pematangsiantar', 'pematang siantar', 'siantar'] },
      { name: 'Tebing Tinggi', keys: ['tebing tinggi'] },
      { name: 'Sibolga', keys: ['sibolga'] },
      { name: 'Padangsidimpuan', keys: ['padangsidimpuan', 'padang sidempuan'] },
      { name: 'Deli Serdang', keys: ['deli serdang', 'lubuk pakam'] },
      { name: 'Kisaran', keys: ['kisaran', 'asahan'] },
      { name: 'Rantauprapat', keys: ['rantauprapat', 'rantau prapat', 'labuhanbatu'] },
      { name: 'Tanjungbalai', keys: ['tanjungbalai', 'tanjung balai'] },
      { name: 'Karo', keys: ['kabanjahe', 'berastagi', 'brastagi'] },
      { name: 'Nias', keys: ['nias', 'gunungsitoli'] },
      { name: 'Toba', keys: ['balige', 'samosir'] },
    ],
  },
  {
    name: 'Sumatera Selatan',
    keys: ['sumatera selatan', 'sumatra selatan', 'sumsel'],
    zone: 'sumsel',
    cities: [
      { name: 'Palembang', keys: ['palembang'] },
      { name: 'Prabumulih', keys: ['prabumulih'] },
      { name: 'Lubuklinggau', keys: ['lubuklinggau', 'lubuk linggau'] },
      { name: 'Pagar Alam', keys: ['pagar alam', 'pagaralam'] },
      { name: 'Lahat', keys: ['lahat'] },
      { name: 'Muara Enim', keys: ['muara enim'] },
      { name: 'Baturaja', keys: ['baturaja'] },
      { name: 'Ogan', keys: ['ogan ilir', 'ogan komering', 'kayuagung', 'indralaya'] },
      { name: 'Banyuasin', keys: ['banyuasin', 'sekayu'] },
    ],
  },
  {
    name: 'Sumatera Barat',
    keys: ['sumatera barat', 'sumatra barat', 'sumbar'],
    at: [-0.947, 100.417],
    cities: [
      { name: 'Padang', keys: ['padang'] },
      { name: 'Bukittinggi', keys: ['bukittinggi'] },
      { name: 'Payakumbuh', keys: ['payakumbuh'] },
    ],
  },
  {
    name: 'Riau',
    keys: ['riau'],
    at: [0.507, 101.448],
    cities: [
      { name: 'Pekanbaru', keys: ['pekanbaru'] },
      { name: 'Dumai', keys: ['dumai'] },
    ],
  },
  {
    name: 'Kepulauan Riau',
    keys: ['kepulauan riau', 'kepri'],
    at: [0.918, 104.459],
    cities: [
      { name: 'Batam', keys: ['batam'], zone: 'batam' },
      { name: 'Tanjungpinang', keys: ['tanjungpinang', 'tanjung pinang', 'bintan'] },
      { name: 'Karimun', keys: ['karimun'] },
    ],
  },
  {
    name: 'Jambi',
    keys: ['jambi'],
    at: [-1.61, 103.613],
    cities: [],
  },
  {
    name: 'Bengkulu',
    keys: ['bengkulu'],
    at: [-3.8, 102.266],
    cities: [],
  },
  {
    name: 'Kepulauan Bangka Belitung',
    keys: ['bangka belitung', 'babel', 'bangka', 'belitung'],
    at: [-2.129, 106.113],
    cities: [
      { name: 'Pangkalpinang', keys: ['pangkalpinang', 'pangkal pinang'] },
    ],
  },
  {
    name: 'Lampung',
    keys: ['lampung'],
    at: [-5.429, 105.262],
    cities: [
      { name: 'Metro', keys: ['kota metro'] },
    ],
  },
  {
    name: 'Bali',
    keys: ['bali'],
    at: [-8.65, 115.217],
    cities: [
      { name: 'Denpasar', keys: ['denpasar', 'badung', 'gianyar', 'tabanan', 'buleleng', 'singaraja', 'kuta', 'ubud'] },
    ],
  },
  {
    name: 'Nusa Tenggara Barat',
    keys: ['nusa tenggara barat', 'ntb'],
    at: [-8.583, 116.117],
    cities: [
      { name: 'Mataram', keys: ['mataram', 'lombok', 'sumbawa'] },
    ],
  },
  {
    name: 'Nusa Tenggara Timur',
    keys: ['nusa tenggara timur', 'ntt'],
    at: [-10.172, 123.607],
    cities: [
      { name: 'Kupang', keys: ['kupang', 'flores', 'ende', 'maumere', 'labuan bajo', 'sumba'] },
    ],
  },
  {
    name: 'Kalimantan Barat',
    keys: ['kalimantan barat', 'kalbar'],
    at: [-0.026, 109.343],
    cities: [
      { name: 'Pontianak', keys: ['pontianak', 'singkawang'] },
    ],
  },
  {
    name: 'Kalimantan Tengah',
    keys: ['kalimantan tengah', 'kalteng'],
    at: [-2.21, 113.92],
    cities: [
      { name: 'Palangka Raya', keys: ['palangka raya', 'palangkaraya', 'sampit'] },
    ],
  },
  {
    name: 'Kalimantan Selatan',
    keys: ['kalimantan selatan', 'kalsel'],
    at: [-3.316, 114.59],
    cities: [
      { name: 'Banjarmasin', keys: ['banjarmasin', 'banjarbaru'] },
    ],
  },
  {
    name: 'Kalimantan Timur',
    keys: ['kalimantan timur', 'kaltim'],
    at: [-0.502, 117.154],
    cities: [
      { name: 'Balikpapan', keys: ['balikpapan'], zone: 'balikpapan' },
      { name: 'Samarinda', keys: ['samarinda'] },
      { name: 'Bontang', keys: ['bontang'] },
      { name: 'Penajam Paser Utara', keys: ['penajam'], at: [-1.25, 116.7] },
    ],
  },
  {
    name: 'Kalimantan Utara',
    keys: ['kalimantan utara', 'kaltara'],
    at: [2.84, 117.37],
    cities: [
      { name: 'Tarakan', keys: ['tarakan'], at: [3.3, 117.633] },
    ],
  },
  {
    name: 'Sulawesi Tengah',
    keys: ['sulawesi tengah', 'sulteng'],
    at: [-0.9, 119.87],
    cities: [
      { name: 'Palu', keys: ['palu'], zone: 'palu' },
    ],
  },
  {
    name: 'Sulawesi Selatan',
    keys: ['sulawesi selatan', 'sulsel'],
    at: [-5.147, 119.432],
    cities: [
      { name: 'Makassar', keys: ['makassar', 'gowa', 'maros', 'parepare'] },
    ],
  },
  {
    name: 'Sulawesi Barat',
    keys: ['sulawesi barat', 'sulbar'],
    at: [-2.68, 118.886],
    cities: [
      { name: 'Mamuju', keys: ['mamuju'] },
    ],
  },
  {
    name: 'Sulawesi Tenggara',
    keys: ['sulawesi tenggara', 'sultra'],
    at: [-3.972, 122.515],
    cities: [
      { name: 'Kendari', keys: ['kendari', 'baubau'] },
    ],
  },
  {
    name: 'Sulawesi Utara',
    keys: ['sulawesi utara', 'sulut'],
    at: [1.474, 124.842],
    cities: [
      { name: 'Manado', keys: ['manado', 'bitung', 'tomohon'] },
    ],
  },
  {
    name: 'Gorontalo',
    keys: ['gorontalo'],
    at: [0.543, 123.057],
    cities: [],
  },
  {
    name: 'Maluku',
    keys: ['maluku'],
    at: [-3.695, 128.181],
    cities: [
      { name: 'Ambon', keys: ['ambon'] },
    ],
  },
  {
    name: 'Maluku Utara',
    keys: ['maluku utara', 'malut'],
    at: [0.79, 127.384],
    cities: [
      { name: 'Ternate', keys: ['ternate', 'sofifi'] },
    ],
  },
  {
    name: 'Papua',
    keys: ['papua', 'papua barat', 'papua barat daya', 'papua tengah', 'papua selatan', 'papua pegunungan'],
    at: [-2.533, 140.717],
    cities: [
      { name: 'Jayapura', keys: ['jayapura'] },
      { name: 'Sorong', keys: ['sorong'], at: [-0.876, 131.255] },
      { name: 'Manokwari', keys: ['manokwari'], at: [-0.861, 134.062] },
      { name: 'Timika', keys: ['timika', 'mimika'], at: [-4.547, 136.888] },
      { name: 'Merauke', keys: ['merauke'], at: [-8.493, 140.401] },
    ],
  },
];

const normalizeAddress = (address) => ` ${String(address || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()} `;

const toRad = (deg) => (deg * Math.PI) / 180;

// Jarak great-circle dalam km.
const distanceKm = ([lat1, lon1], [lat2, lon2]) => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
};

const nearestZone = (point) => {
  let best = null;
  for (const [zoneId, zone] of Object.entries(SHIPPING_ZONES)) {
    for (const anchor of zone.anchors) {
      const km = distanceKm(point, anchor);
      if (!best || km < best.km) best = { zoneId, km };
    }
  }
  return best.zoneId;
};

// Posisi akhir kemunculan terakhir `key` sebagai kata utuh, atau -1.
const lastMatchEnd = (text, key) => {
  const idx = text.lastIndexOf(` ${key} `);
  return idx === -1 ? -1 : idx + key.length + 1;
};

const findMatches = (text) => {
  const matches = [];
  for (const province of PROVINCES) {
    for (const key of province.keys) {
      const end = lastMatchEnd(text, key);
      if (end !== -1) matches.push({ province, city: null, end, keyLength: key.length });
    }
    for (const city of province.cities) {
      for (const key of city.keys) {
        const end = lastMatchEnd(text, key);
        if (end !== -1) matches.push({ province, city, end, keyLength: key.length });
      }
    }
  }
  return matches;
};

const isLater = (a, b) => (
  a.end !== b.end ? a.end > b.end : a.keyLength > b.keyLength
);

const latest = (matches) => matches.reduce((best, m) => (!best || isLater(m, best) ? m : best), null);

/**
 * Kg yang ditagih dari total berat (gram). Berat tidak diketahui → 1 kg.
 * @param {number|null|undefined} weightGrams
 */
const billableKg = (weightGrams) => {
  const grams = Math.max(0, Math.round(Number(weightGrams) || 0));
  const whole = Math.floor(grams / 1000);
  const rest = grams % 1000;
  return Math.max(1, whole + (rest > WEIGHT_TOLERANCE_GRAMS ? 1 : 0));
};

/**
 * Hitung ongkir dari teks alamat dan total berat pesanan.
 *
 * @param {string} address
 * @param {number} [weightGrams] total berat (gram); kosong = 1 kg
 * @returns {{ zone: string, zoneLabel: string, cost: number, baseCost: number, extraPerKg: number,
 *   weightGrams: number|null, billedKg: number, matchedPlace: string, byNearest: boolean } | null}
 *   null bila tidak ada kota/provinsi yang dikenali (atau hanya "Jawa Barat"
 *   tanpa kota) — pembeli perlu melengkapi alamat.
 */
const quoteShipping = (address, weightGrams) => {
  const matches = findMatches(normalizeAddress(address));
  if (!matches.length) return null;

  let chosen = latest(matches);
  if (!chosen.city) {
    const sameProvinceCity = latest(matches.filter((m) => m.city && m.province === chosen.province));
    if (sameProvinceCity) chosen = sameProvinceCity;
  }

  const { province, city } = chosen;
  let zoneId = (city && city.zone) || province.zone || null;
  let byNearest = false;
  if (!zoneId) {
    const point = (city && city.at) || province.at;
    if (!point) return null;
    zoneId = nearestZone(point);
    byNearest = true;
  }

  const zone = SHIPPING_ZONES[zoneId];
  const billedKg = billableKg(weightGrams);
  return {
    zone: zoneId,
    zoneLabel: zone.label,
    cost: zone.cost + (billedKg - 1) * zone.extraPerKg,
    baseCost: zone.cost,
    extraPerKg: zone.extraPerKg,
    weightGrams: weightGrams != null && Number.isFinite(Number(weightGrams)) ? Math.round(Number(weightGrams)) : null,
    billedKg,
    matchedPlace: city ? `${city.name}, ${province.name}` : province.name,
    byNearest,
  };
};

module.exports = {
  SHIPPING_ZONES,
  DEFAULT_ITEM_WEIGHT_GRAMS,
  billableKg,
  quoteShipping,
};
