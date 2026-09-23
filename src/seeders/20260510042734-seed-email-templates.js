'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.bulkInsert('EmailTemplates', [
      {
        key: 'donation_payment_confirmation',
        title: 'Donasi - Pembayaran Berhasil',
        subject: 'Konfirmasi Donasi IOM ITB',
        body: `Terima kasih {{name}} atas kontribusi Anda kepada IOM ITB.

Pembayaran donasi Anda telah berhasil dikonfirmasi.

Jenis Donasi: {{donationType}}
Jumlah: Rp {{amount}}
ID Transaksi: {{transactionId}}

Dukungan Anda sangat berarti bagi keberlangsungan program dan kegiatan IOM ITB.

Salam hangat,
IOM ITB`,
        variables: JSON.stringify(['name', 'donationType', 'amount', 'transactionId']),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        key: 'transaction_payment_confirmation',
        title: 'Merchandise - Pembayaran Berhasil',
        subject: 'Konfirmasi Pesanan IOM ITB',
        body: `Halo {{username}},

Pembayaran pesanan Anda telah berhasil! Pesanan sedang diproses.

Kode Pesanan: {{code}}
Produk: {{merchandiseName}} x {{qty}}
{{notesBlock}}
Total: Rp {{amount}}

Pantau status pesanan melalui tautan berikut:
{{orderStatusUrl}}`,
        variables: JSON.stringify(['username', 'code', 'merchandiseName', 'qty', 'amount', 'orderStatusUrl']),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('EmailTemplates', {
      key: [
        'donation_payment_confirmation',
        'transaction_payment_confirmation',
      ],
    });
  },
};