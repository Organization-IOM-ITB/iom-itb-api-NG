# Migrasi Kegiatan & Pelepasan Gambar dari Stack v1/v2

Latar: **stack v1 (`upload00.iom-itb.id`) dan v2 (`iom-apiv2.iom-itb.id`)
akan dihentikan.** Selama kolom `Activities.image` masih menunjuk ke sana,
halaman Kegiatan akan kehilangan gambar begitu stack lama dimatikan.

Per 23 September 2026, dari 66 kegiatan di NG:

| Host gambar | Jumlah | Keterangan |
|---|---|---|
| `iom-apiv2.iom-itb.id` | 39 | stack v2 |
| `upload00.iom-itb.id` | 17 | stack v1 |
| `api.upload-iom-itb.…sslip.io` | 7 | **sudah mati (404)** — berkas hilang, juga rusak di v1 |
| eksternal (tvrinews, myimgs, dll) | 3 | dibiarkan |

Selain kegiatan, endpoint publik lain sudah bersih: merchandise sudah
memakai `api-ng.iom-itb.id/uploads/`, sementara kemitraan,
kegiatan-kemitraan, dan competition masih kosong.

---

## 1. Impor 19 kegiatan yang belum ada di NG

NG tertinggal 19 kegiatan yang hanya ada di v1 (semuanya dibuat
2026-09-03, acara Mei–September 2026). Datanya sudah diekstrak ke
`migration-data/activities-2026-09.json`.

```bash
# di dalam container api-ng
node scripts/importLegacyActivities.js \
  --dry-run \
  --file=migration-data/activities-2026-09.json \
  --base-url=https://api-ng.iom-itb.id

# periksa migration-reports/activities-dry-run.json, lalu:
node scripts/importLegacyActivities.js \
  --apply \
  --file=migration-data/activities-2026-09.json \
  --base-url=https://api-ng.iom-itb.id
```

Script akan:

- membuat slug dari judul (kolom `url` di data sumber berisi tautan
  Instagram/eksternal, jadi dilampirkan sebagai "Link terkait" di akhir
  deskripsi — perilaku yang sama seperti waktu 66 kegiatan diimpor);
- **mengunduh gambar dari `upload00` ke `src/uploads`** dan menulis URL
  `https://api-ng.iom-itb.id/uploads/…`, sehingga tidak ada
  ketergantungan baru ke stack lama;
- melewati baris yang judul+tanggalnya sudah ada (idempoten).

## 2. Pindahkan gambar 63 kegiatan lama ke NG

```bash
node scripts/rehostActivityImages.js --dry-run
node scripts/rehostActivityImages.js --apply --base-url=https://api-ng.iom-itb.id
```

Aman dijalankan berulang: nama berkas diturunkan dari hash URL asal, dan
baris yang sudah menunjuk NG dilewati.

**7 kegiatan akan gagal** (NG id 20–26) karena host sumbernya sudah mati
— berkasnya memang sudah tidak ada, dan URL yang sama juga 404 di v1.
Baris ini **sengaja tidak diubah** supaya URL aslinya tetap terlihat untuk
penelusuran. Gambarnya perlu diunggah ulang manual lewat admin:

- Laptop Purna Pakai
- Penerimaan Mahasiswa Baru ITB 2025
- Pembinaan Terpusat Asrama ITB
- Pemberian Makanan dan Takjil Asrama pada Bulan Ramadhan 2025
- Penerimaan Pengurus IOM-ITB oleh Prof. Dr. Tatacipta Dirgantara
- Dies Natalis ITB Ke-66
- Peluang Kolaborasi IOM dengan Direktorat Kealumnian

## 3. Verifikasi sebelum mematikan v1/v2

```bash
# harus mengembalikan 0 kegiatan yang masih menunjuk host lama
node scripts/rehostActivityImages.js --dry-run
```

Cek juga dari luar:

```bash
curl -s "https://api-ng.iom-itb.id/activities?page=1" \
  | grep -oE 'https?://[a-z0-9.-]+' | sort -u
```

Tidak boleh lagi muncul `upload00`, `iom-apiv2`, atau `sslip.io`.

---

## Catatan

- `src/uploads` adalah **volume persisten** Coolify
  (`ckm8cen2mnpjwzo67uxviyn3_app-uploads`), jadi hasil unduhan bertahan
  melewati deploy. ⚠️ Saat ini ada **dua volume berbeda ter-mount ke path
  yang sama** (`app-uploads` dan `app-uploads-ng`) — sisa insiden rename
  volume; perlu dirapikan terpisah.
- Daftar host lama ada di satu tempat, `scripts/lib/legacyImages.js`
  (`LEGACY_IMAGE_HOSTS`), dipakai kedua script.
- `iom-itb-app-NG/.env` masih memuat
  `VUE_APP_API_UPLOAD="https://api.upload-iom-itb.…sslip.io"` yang sudah
  mati, tetapi variabel itu **tidak pernah dibaca kode manapun** — hanya
  ikut ter-bundle karena Vue CLI menyertakan semua `VUE_APP_*`. Tidak
  berdampak; layak dibersihkan saat ada perubahan lain di repo itu.
