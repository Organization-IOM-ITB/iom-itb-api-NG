-- Memindahkan Penerima, DanaBantuan, dan Donations dari v1 ke NG.
--
-- Prasyarat (lihat doc/migrasi-data-v1-dana-bantuan-donasi.md):
--   1. migration 20261002150000-create-penerima-and-dana-bantuan sudah jalan
--   2. tabel v1 sudah dimuat ke schema sementara `v1_import` di MySQL NG
--
-- Jalankan di database NG. Aman diulang: baris yang sudah dipindah dilewati.

START TRANSACTION;

-- Penerima & DanaBantuan: struktur identik dan tabel NG masih kosong, jadi
-- ID v1 dipertahankan (relasi id_penerima tetap utuh).
INSERT INTO Penerima (id_penerima, nama, nim, program_studi)
SELECT v.id_penerima, v.nama, v.nim, v.program_studi
FROM v1_import.Penerima v
WHERE NOT EXISTS (SELECT 1 FROM Penerima p WHERE p.id_penerima = v.id_penerima);

INSERT INTO DanaBantuan (id_dana, id_penerima, jenis_bantuan, bulan, tahun, jumlah_donasi)
SELECT v.id_dana, v.id_penerima, v.jenis_bantuan, v.bulan, v.tahun, v.jumlah_donasi
FROM v1_import.DanaBantuan v
WHERE NOT EXISTS (SELECT 1 FROM DanaBantuan d WHERE d.id_dana = v.id_dana);

-- Donations: NG sudah punya baris sendiri (ID 1..), jadi baris v1 mendapat
-- ID baru. ID asal disimpan di options.legacyV1Id sebagai penanda dedupe.
-- Di v1 donasi hanya bisa dibuat admin (POST butuh login) → semuanya donasi
-- yang sudah dicatat: manual + settlement. Tanpa ini NG menampilkannya
-- sebagai "pending".
INSERT INTO Donations (
  name, email, noWhatsapp, proof, notification, createdAt, updatedAt,
  amount, options, date, bank,
  paymentMethod, paymentStatus, nameIsHidden, isHambaAllah, paidAt, currency, publicToken
)
SELECT
  v.name, v.email, v.noWhatsapp, v.proof, v.notification, v.createdAt, v.updatedAt,
  v.amount,
  JSON_SET(COALESCE(v.options, JSON_OBJECT()), '$.legacyV1Id', v.id),
  v.date, v.bank,
  'manual', 'settlement',
  IF(JSON_UNQUOTE(JSON_EXTRACT(v.options, '$.nameIsHidden')) IN ('true', '1'), 1, 0),
  IF(JSON_UNQUOTE(JSON_EXTRACT(v.options, '$.isHambaAllah')) IN ('true', '1'), 1, 0),
  COALESCE(v.date, v.createdAt),
  'IDR',
  -- Format sama dengan migration 20260601000001: 'ord_' + base64url(24 byte).
  CONCAT('ord_', REPLACE(REPLACE(TO_BASE64(RANDOM_BYTES(24)), '+', '-'), '/', '_'))
FROM v1_import.Donations v
WHERE NOT EXISTS (
  SELECT 1 FROM Donations d
  WHERE JSON_UNQUOTE(JSON_EXTRACT(d.options, '$.legacyV1Id')) = CAST(v.id AS CHAR)
);

COMMIT;

-- Verifikasi: kolom v1 dan ng harus sama.
SELECT 'Penerima' tabel,
       (SELECT COUNT(*) FROM v1_import.Penerima) v1,
       (SELECT COUNT(*) FROM Penerima) ng
UNION ALL
SELECT 'DanaBantuan',
       (SELECT COUNT(*) FROM v1_import.DanaBantuan),
       (SELECT COUNT(*) FROM DanaBantuan)
UNION ALL
SELECT 'Donations dari v1',
       (SELECT COUNT(*) FROM v1_import.Donations),
       (SELECT COUNT(*) FROM Donations WHERE JSON_EXTRACT(options, '$.legacyV1Id') IS NOT NULL)
UNION ALL
SELECT 'Total nominal donasi v1',
       (SELECT COALESCE(SUM(amount), 0) FROM v1_import.Donations),
       (SELECT COALESCE(SUM(amount), 0) FROM Donations WHERE JSON_EXTRACT(options, '$.legacyV1Id') IS NOT NULL)
UNION ALL
SELECT 'Total dana bantuan',
       (SELECT SUM(jumlah_donasi) FROM v1_import.DanaBantuan),
       (SELECT SUM(jumlah_donasi) FROM DanaBantuan);
