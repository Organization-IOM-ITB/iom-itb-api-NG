'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.bulkInsert('EmailTemplates', [
      {
        key: 'donation_payment_whatsapp',
        title: 'Donasi - Konfirmasi Pembayaran (WhatsApp)',
        subject: null,
        body: `Halo {{name}}!

Pembayaran donasi Anda sebesar Rp {{amount}} telah berhasil dikonfirmasi.

Terima kasih atas kontribusi Anda kepada IOM ITB!

Salam,
IOM ITB`,
        variables: JSON.stringify(['name', 'amount']),
        channel: 'whatsapp',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        key: 'transaction_payment_whatsapp',
        title: 'Merchandise - Konfirmasi Pembayaran (WhatsApp)',
        subject: null,
        body: `Halo {{username}}!

Pembayaran pesanan Anda telah berhasil!

Kode Pesanan: {{code}}
Produk: {{merchandise_name}} x {{qty}}
{{notes_block}}
Total: Rp {{amount}}

Pesanan Anda sedang diproses. Pantau status pesanan melalui tautan berikut:
{{order_status_url}}

Salam,
IOM ITB`,
        variables: JSON.stringify(['username', 'code', 'merchandise_name', 'qty', 'amount', 'order_status_url']),
        channel: 'whatsapp',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('EmailTemplates', {
      key: ['donation_payment_whatsapp', 'transaction_payment_whatsapp'],
    });
  },
};
