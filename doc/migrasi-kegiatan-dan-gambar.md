# Migrasi Kegiatan & Pelepasan Gambar dari Stack v1/v2

Latar: **stack v1 (`upload00.iom-itb.id`) dan v2 (`iom-apiv2.iom-itb.id`)
akan dihentikan.** Selama kolom `Activities.image` masih menunjuk ke sana,
halaman Kegiatan akan kehilangan gambar begitu stack lama dimatikan.

Per 23 September 2026, dari 66 kegiatan di NG:

| Host gambar | Jumlah | Keterangan |
|---|---|---|
| `iom-apiv2.iom-itb.id` | 39 | stack v2 — **semuanya berhasil dipindah** |
| `upload00.iom-itb.id` | 18 | stack v1 — hanya 1 berhasil, 17 sisanya berkasnya sudah 404 |
| `api.upload-iom-itb.…sslip.io` | 7 | host sudah mati |
| eksternal (tvrinews, myimgs, dll) | 3 | dibiarkan |

> Angka di atas dihitung dari basis data (88 baris). Endpoint publik
> menampilkan 85 karena controller `GetAllActivities` meneruskan
> `status: 'published'` secara hardcode — jadi **3 baris berstatus
> `draft`**. (Service `getActivities.js` sendiri tidak memfilter status;
> filternya ada di controller.) Perlu dicek apakah ketiganya memang
> sengaja disimpan sebagai draf.

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

**24 kegiatan gagal dipindah** — berkas sumbernya sudah tidak ada.
Baris ini **sengaja tidak diubah** supaya URL aslinya tetap terlihat untuk
penelusuran. Gambarnya perlu diunggah ulang manual lewat admin.

Diverifikasi 23 September 2026: untuk ke-17 yang di `upload00`, URL di NG
**identik** dengan yang tersimpan di v1, dan keduanya tetap 404 setelah
redirect diikuti — artinya **www-v1 pun menampilkan gambar rusak untuk
kegiatan yang sama**. Tidak ada yang bisa dipulihkan dari v1, dan tidak
ada yang hilang akibat migrasi ini.

| Host asal | Jumlah | Keterangan |
|---|---|---|
| `upload00.iom-itb.id` | 17 | berkas sudah 404 di v1 juga |
| `api.upload-iom-itb.…sslip.io` | 7 | host sudah mati |

NG id yang terdampak: **7–17, 20–32** (sebagian; daftar persisnya ada di
`migration-reports/rehost-images-apply.json`, cari `"action": "failed"`).

### ⚠️ Ke-24 baris itu memakai `http://` — mixed content

Kolom `image` ke-24 baris tersebut tersimpan sebagai **`http://`**, bukan
`https://`. Karena situs dilayani lewat HTTPS, browser memblokirnya
sebagai *mixed content*. Artinya: **memulihkan berkasnya saja tidak
cukup** — selama skemanya `http://`, gambarnya tetap tidak tampil.

Saat mengunggah ulang lewat admin, pastikan URL hasilnya berbentuk
`https://api-ng.iom-itb.id/uploads/…`, bukan menambal berkas di host lama.

> Catatan membaca log: pesan kegagalan script menampilkan URL berskema
> `https://` padahal yang tersimpan `http://`. Itu bukan ketidakcocokan —
> `requestBuffer` mengikuti redirect `http → https` lalu melaporkan error
> pada URL akhir. Hal yang sama membuat `curl` tanpa `-L` membalas `302`
> sementara permintaan `https` langsung membalas `404`.

### Hasil verifikasi pasca-migrasi (23 September 2026)

| Pemeriksaan | Hasil |
|---|---|
| Gambar hasil migrasi benar-benar terlayani | **58/58** balas `200 image/*` |
| Halaman detail 19 kegiatan baru (slug) | **19/19** balas `200` |
| Duplikat judul / slug | tidak ada |
| Status, kontributor, tanggal, deskripsi, "Link terkait" | cocok dengan sumber v1 |
| CORS dari `www.iom-itb.id`, `iom-itb.id`, `www-ng` | ketiganya lolos |
| Data 24 baris rusak | judul, deskripsi, slug tetap utuh — hanya gambar kosong |

Skema URL gambar seluruh 85 kegiatan sesudahnya:

| Skema | Host | Jumlah |
|---|---|---|
| `https` | `api-ng.iom-itb.id` | 58 |
| `http` | `upload00.iom-itb.id` | 17 ⚠️ |
| `http` | `api.upload-iom-itb.…sslip.io` | 7 ⚠️ |
| `https` | eksternal (tvrinews, myimgs, iom-itb.id) | 3 |

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
