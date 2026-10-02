# Tally → api-NG: webhook, donasi, dan backfill

**Latar (2026-10-02).** Dashboard Tally tidak punya satu pun webhook ke api-NG,
jadi sejak seed CSV (±22 April 2026) tidak ada submission yang masuk DB NG.
Form DONASI bahkan belum punya endpoint — padahal selama pembayaran otomatis
(Midtrans) dinonaktifkan, itulah satu-satunya jalur donasi di www-NG.

| Form | Tally ID | Endpoint | Masuk sejak 22 Apr |
|---|---|---|---|
| PENDAFTARAN ANGGOTA | `wzeRrM` | `/webhooks/tally/pendaftaran-anggota` | 1650 |
| PENGAJUAN BANTUAN | `mV8yPg` | `/webhooks/tally/pengajuan-bantuan` | 111 |
| Form Orang Tua Asuh | `w4p8ak` | `/webhooks/tally/orangtua-asuh` | 93 |
| DONASI | `mZJe8e` | `/webhooks/tally/donasi` (baru) | 39 |

Base URL: `https://api-ng.iom-itb.id`.

## Perubahan kode yang mendasari

- **Bug label kembar diperbaiki** (`src/utils/tallyPayloadNormalizer.js`).
  Beberapa form punya pertanyaan berlabel sama (varian kondisional): "Nama" ×2
  di Pengajuan Bantuan, "Nama Mahasiswa" & "Provinsi Domisili…" ×2 di
  Pendaftaran Anggota, "Upload Bukti Bayar" ×3 dan "Tanda Terima" ×3 di Donasi.
  Dulu jawaban kosong berikutnya **menimpa** jawaban yang terisi (nama pemohon
  dan bukti transfer hilang). Sekarang yang kosong diabaikan; dua jawaban
  terisi yang berbeda disimpan sebagai `Label` dan `Label (2)`.
- **Jalur CSV kena bug yang sama** dari sisi lain: `csv-parse` dengan
  `columns: true` hanya menyimpan kolom terakhir berjudul sama. Seed April
  kemungkinan kehilangan sebagian "Nama". Diperbaiki dengan
  `group_columns_by_name: true`; backfill di langkah C sekaligus memperbaiki
  baris-baris itu.
- **Donasi**: slug `donasi` (migration `20261002120000`), endpoint webhook,
  template WA `donasi_form_whatsapp` (migration `20261002120500`, bisa diedit di
  menu Template Pesan). Data donasi hanya bisa dibaca **FINANCE_ROLES** (admin,
  pengurus-bidang-1, bendahara) — sekretariat tidak.
- Label telepon "No HP / WA" kini dikenali (dulu tidak cocok pola apa pun).

## A. Deploy + migration

1. Deploy `iom-itb-api-ng`, lalu jalankan migration (production tidak
   menjalankannya otomatis):

```bash
APP=$(docker ps --format '{{.Names}}' | grep ^app-ckm8cen2mnpjwzo67uxviyn3 | head -1)
docker exec "$APP" npm run migrate
```

2. Deploy `iom-itb-admin-ng` (tab baru di halaman Donasi).
3. Opsional: env `TALLY_WHATSAPP_TEMPLATE_DONASI` di Coolify. **Perhatikan**:
   pengirim WA otomatis memakai urutan env per-form → `TALLY_WHATSAPP_TEMPLATE_DEFAULT`
   → teks bawaan kode. Karena `TALLY_WHATSAPP_TEMPLATE_DEFAULT` ada di Coolify,
   tanpa env per-form donatur akan menerima teks DEFAULT itu, bukan teks donasi
   bawaan kode. Teks bawaan sengaja tidak menyebut dana "sudah diterima".

## B. Pasang webhook di Tally (4 form)

Tiap form → **Integrations** → **Webhooks** → Connect. URL = base URL + endpoint
di tabel atas. **Signing secret** = nilai `TALLY_WEBHOOK_SECRET` milik
`iom-itb-api-ng` di Coolify (header `Tally-Signature`, HMAC-SHA256 base64;
wajib di production).

- Jangan hapus integrasi Google Sheets yang sudah ada (v1 masih membacanya).
- ⚠️ Mulai saat ini setiap submission baru memicu **WhatsApp konfirmasi** ke
  pengisi (`triggerWhatsappNotificationStub.js` — namanya "Stub" tapi
  sungguhan mengirim lewat `WA_API_URL`). Matikan sementara dengan
  `TALLY_WHATSAPP_NOTIFICATIONS_ENABLED=false` bila perlu.
- Verifikasi: events log webhook (ikon 🕔) harus `200 Webhook processed
  successfully`. `401` = signing secret tidak sama.

Sudah diuji lokal (MySQL 8 + api-NG): tanpa/salah signature → 401; benar →
200; kiriman ulang → "Duplicate webhook event ignored"; bukti transfer dan
nomor WA tersimpan meski ada field kembar kosong.

## C. Backfill dari CSV (setelah B, supaya tidak ada celah)

`scripts/importTallyCsv.js`, satu form per pemanggilan:

- Dedupe pada `(formSlug, tallySubmissionId)` → aman diulang.
- Baris asal webhook **tidak ditimpa**; baris asal `csv_seed` diperbarui.
- **Tidak mengirim WhatsApp/email.**
- Pengajuan Bantuan baru → status `TIDAK_DIKETAHUI` (mungkin sudah diproses
  lewat jalur lama), tercatat di riwayat dengan `IMPORT_CSV`.
- Output hanya jumlah dan tanggal.

1. Di Tally: tiap form → **Submissions** → download CSV.
2. Salin ke container dan jalankan **dry-run dulu**:

```bash
APP=$(docker ps --format '{{.Names}}' | grep ^app-ckm8cen2mnpjwzo67uxviyn3 | head -1)
docker exec "$APP" mkdir -p /tmp/tally-csv
docker cp donasi.csv "$APP":/tmp/tally-csv/donasi.csv   # ulangi untuk tiap file

docker exec "$APP" node scripts/importTallyCsv.js --form=donasi --file=/tmp/tally-csv/donasi.csv --dry-run
docker exec "$APP" node scripts/importTallyCsv.js --form=donasi --file=/tmp/tally-csv/donasi.csv --apply
```

   Form: `pendaftaran_anggota`, `pengajuan_bantuan`, `orang_tua_asuh`, `donasi`.

3. Hapus CSV (berisi data pribadi) dari container **dan** server:

```bash
docker exec "$APP" rm -rf /tmp/tally-csv
```

4. Verifikasi — jumlah per form ≈ total di Tally:

```bash
MC=$(docker ps --format '{{.Names}}' | grep ^mysql-ckm8cen2mnpjwzo67uxviyn3 | head -1)
docker exec -i "$MC" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' <<'SQL'
SELECT formSlug, sourceType, COUNT(*) n, MAX(submittedAt) terakhir
  FROM TallySubmissions GROUP BY formSlug, sourceType;
SQL
```

## Belum dikerjakan

- Konfirmasi transfer di admin belum bisa ditandai "sudah dicatat" atau
  diubah langsung menjadi baris `Donations`; bendahara mencatat manual lewat
  tab Catatan Donasi.
- Route lama berbasis Google Apps Script (`/donasi`, `/orangtua-asuh`,
  `/pendataan-anggota`, `/pengajuan-bantuan` + env `URL_EXCEL`) tidak dipakai
  admin-NG dan bisa dihapus.
