# Migrasi data v1 → NG: Penerima, Dana Bantuan, Donasi

**Latar (2026-10-02).** Halaman Dana Bantuan dan Catatan Donasi di admin-NG
kosong. Penyebabnya dua:

1. **Tabel `Penerima` dan `DanaBantuan` tidak ada di DB NG.** Model dan route
   `/dana-bantuan` sudah ada, tetapi di v1 kedua tabel dibuat manual di luar
   migration, sehingga tidak ada migration yang ikut terbawa ke NG. API
   `/dana-bantuan` selalu gagal.
2. **Data v1 tidak pernah dipindahkan.** Di v1 (`database-iom`, database
   `iom-itb`): Penerima 2288, DanaBantuan 2780, Donations 633. Di NG:
   Donations 9 (semuanya uji Midtrans 19 Juni 2026), dua tabel lain tidak ada.

Hasil pemeriksaan v1: tidak ada DanaBantuan tanpa penerima; 9 donasi v1
tanpa nominal; rentang tanggal donasi 2024-03-24 s/d 2026-09-20.

## Yang dibawa kode

- Migration `20261002150000-create-penerima-and-dana-bantuan`: membuat kedua
  tabel meniru `SHOW CREATE TABLE` v1 (BIGINT UNSIGNED, `nim` unik, collation
  `utf8mb4_unicode_ci`), plus foreign key `DanaBantuan.id_penerima →
  Penerima` (v1 hanya index). Juga memperlebar `Donations.proof` 255 → 1000
  seperti v1.
- `scripts/sql/import-v1-dana-bantuan-donasi.sql`: pemindahan data, aman
  diulang.
  - Penerima & DanaBantuan: ID v1 dipertahankan.
  - Donations: ID baru (NG sudah punya ID 1–9); ID v1 disimpan di
    `options.legacyV1Id`. Semua donasi v1 dibuat admin → `manual` +
    `settlement`, `paidAt` = tanggal donasi. `options` (nameIsHidden,
    isHambaAllah) disalin apa adanya — format sama dengan NG — dan juga diisi
    ke kolom `nameIsHidden`/`isHambaAllah`. `publicToken` dibuat baru.

## Langkah

Nama container:

```bash
V1=bk4og08g4o4c0oc0wskssksk
NG=$(docker ps --format '{{.Names}}' | grep ^mysql-ckm8cen2mnpjwzo67uxviyn3 | head -1)
APP=$(docker ps --format '{{.Names}}' | grep ^app-ckm8cen2mnpjwzo67uxviyn3 | head -1)
echo "V1=$V1 NG=$NG APP=$APP"
```

### 1. Backup kedua database

`database-iom` (v1) tidak punya backup schedule, jadi ini sekaligus backup
pertamanya.

```bash
docker exec "$NG" sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$MYSQL_DATABASE"' 2>/dev/null \
  | gzip > /root/ng-backup-$(date +%Y%m%d-%H%M).sql.gz
docker exec "$V1" sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines iom-itb' 2>/dev/null \
  | gzip > /root/v1-iom-itb-backup-$(date +%Y%m%d-%H%M).sql.gz
ls -lh /root/*backup*.sql.gz      # pastikan ukurannya bukan beberapa byte
```

### 2. Deploy api-NG, lalu migration

```bash
docker exec "$APP" npm run migrate
```

Harus muncul `20261002150000-create-penerima-and-dana-bantuan: migrated`.

### 3. Muat tabel v1 ke schema sementara di MySQL NG

Langsung disalurkan antar-container — tidak ada file berisi data pribadi
tertinggal di disk.

```bash
docker exec "$NG" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE v1_import"' 2>/dev/null
docker exec "$V1" sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --set-gtid-purged=OFF iom-itb Penerima DanaBantuan Donations' 2>/dev/null \
  | docker exec -i "$NG" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" v1_import' 2>/dev/null
```

### 4. Pindahkan data

Salin isi `scripts/sql/import-v1-dana-bantuan-donasi.sql` ke server (atau
ambil dari container app), lalu:

```bash
docker exec "$APP" cat scripts/sql/import-v1-dana-bantuan-donasi.sql \
  | docker exec -i "$NG" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' 2>/dev/null
```

Output terakhir adalah tabel verifikasi — kolom `v1` dan `ng` harus sama
untuk kelima baris (jumlah baris dan total nominal).

### 5. Bersihkan schema sementara

```bash
docker exec "$NG" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "DROP DATABASE v1_import"' 2>/dev/null
```

### 6. Cek di admin-NG

- **Dana Bantuan**: daftar penerima & penyaluran tampil.
- **Donasi → Catatan Donasi**: 633 donasi v1 tampil, metode Manual, status
  settlement.
- Daftar donatur publik di www-NG juga akan menampilkan donasi v1 (seperti
  dulu di v1).

## Rollback

Hapus hasil impor saja (tidak menyentuh 9 donasi NG):

```sql
DELETE FROM Donations WHERE JSON_EXTRACT(options, '$.legacyV1Id') IS NOT NULL;
DELETE FROM DanaBantuan;
DELETE FROM Penerima;
```

Atau pulihkan seluruhnya dari `/root/ng-backup-*.sql.gz`.

## Catatan

- Bukti transfer donasi v1 (`proof`) menunjuk ke upload00 — sebagian besar
  berkasnya sudah tidak ada (runner v1 tanpa persistent storage). Datanya
  tetap dipindah; tautannya mungkin mati.
- Bug lama yang ikut terbawa dari v1: `createDanaBantuan` selalu membuat
  Penerima baru, sedangkan `nim` unik → menambah dana kedua untuk mahasiswa
  yang sudah terdaftar akan gagal.
- Daftar donasi publik (`GET /donations`) menampilkan semua status, termasuk
  donasi Midtrans yang `expired`/`failed`.
- Tabel `Members` v1 (19 baris) belum ditangani.
