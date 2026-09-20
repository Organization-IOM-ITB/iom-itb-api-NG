const {
  logoAttachment,
  LOGO_CID,
  buildOrderStatusUrl,
  renderOrderStatusCta,
  renderEmailFooter,
} = require('./emailLayout');
const { DONATION_TYPE_LABEL } = require('../../../dtos/payments');
const { getRenderedEmailTemplate } = require('./templateRenderer');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const titleCase = (value) => String(value || '')
  .split(/[_\s-]+/)
  .filter(Boolean)
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  .join(' ');

const prettifyDonationType = (value) => {
  if (!value) return 'Umum';
  return DONATION_TYPE_LABEL[value] || titleCase(value);
};

const buildDonationPaymentEmail = async ({ name, amount, donationType, transactionId }) => {
  const formattedDonationType = prettifyDonationType(donationType);

  const data = {
    name,
    amount,
    donationType: formattedDonationType,
    transactionId,
  };

  const rendered = await getRenderedEmailTemplate(
    'donation_payment_confirmation',
    data,
    {
      subject: 'Konfirmasi Donasi IOM ITB',
      body: `Halo {{name}},

Pembayaran donasi Anda telah berhasil dikonfirmasi.

Jenis Donasi: {{donationType}}
Jumlah: Rp {{amount}}
ID Transaksi: {{transactionId}}

Terima kasih atas kontribusi Anda kepada IOM ITB!`,
    }
  );

  return {
    subject: rendered.subject,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="cid:${LOGO_CID}" alt="IOM ITB" style="max-width:180px;height:auto;" />
  </div>
  <h2 style="color:#1d4ed8;margin-bottom:4px;">IOM ITB</h2>
  <p style="color:#6b7280;margin-top:0;">${rendered.subject}</p>
  <div style="height:1px;background:#e5e7eb;margin:16px 0;"></div>
  ${rendered.bodyHtml}
  ${renderEmailFooter()}
</div>`,
    attachments: [logoAttachment()],
  };
};

const buildTransactionPaymentEmail = async ({
  username,
  code,
  merchandiseName,
  qty,
  amount,
  transactionId,
  orderStatusToken,
  orderStatusUrl,
}) => {
  const data = {
    username,
    code,
    merchandiseName,
    qty,
    amount,
    transactionId,
    orderStatusUrl: orderStatusUrl || buildOrderStatusUrl(orderStatusToken),
  };

  const rendered = await getRenderedEmailTemplate(
    'transaction_payment_confirmation',
    data,
    {
      subject: 'Konfirmasi Pesanan IOM ITB',
      body: `Halo {{username}},

Pembayaran pesanan Anda telah berhasil.

Kode Pesanan: {{code}}
Produk: {{merchandiseName}} x {{qty}}
Total: Rp {{amount}}

Terima kasih telah berbelanja di IOM ITB!`,
    }
  );

  return {
    subject: rendered.subject,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="cid:${LOGO_CID}" alt="IOM ITB" style="max-width:180px;height:auto;" />
  </div>
  <h2 style="color:#1d4ed8;margin-bottom:4px;">IOM ITB</h2>
  <p style="color:#6b7280;margin-top:0;">${rendered.subject}</p>
  <div style="height:1px;background:#e5e7eb;margin:16px 0;"></div>
  ${rendered.bodyHtml}
  ${renderOrderStatusCta(data.orderStatusUrl)}
  ${renderEmailFooter()}
</div>`,
    attachments: [logoAttachment()],
  };
};

const buildTransactionProofReceivedEmail = ({ username, code, merchandiseName, qty, amount, transactionId, orderStatusToken, orderStatusUrl }) => ({
  subject: 'Bukti Pembayaran Diterima — IOM ITB',
  html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="cid:${LOGO_CID}" alt="IOM ITB" style="max-width:180px;height:auto;" />
  </div>
  <h2 style="color:#1d4ed8;margin-bottom:4px;">IOM ITB</h2>
  <p style="color:#6b7280;margin-top:0;">Bukti Pembayaran Telah Kami Terima</p>
  <div style="height:1px;background:#e5e7eb;margin:16px 0;"></div>
  <p>Halo <strong>${username}</strong>,</p>
  <p>Terima kasih, kami telah menerima bukti pembayaran Anda. Tim IOM ITB akan memverifikasi pembayaran dalam 1x24 jam.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:8px 0;color:#6b7280;">Kode Pesanan</td><td style="padding:8px 0;font-weight:bold;">${code}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;">Produk</td><td style="padding:8px 0;">${merchandiseName} x ${qty}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;">Total</td><td style="padding:8px 0;font-weight:bold;color:#16a34a;">Rp ${amount}</td></tr>
  </table>
  <p>Anda akan mendapat notifikasi lanjutan setelah pembayaran terverifikasi.</p>
  ${renderOrderStatusCta(orderStatusUrl || buildOrderStatusUrl(orderStatusToken))}
  <p style="color:#6b7280;font-size:13px;margin-top:24px;">Salam,<br><strong>IOM ITB</strong></p>
</div>`,
  attachments: [logoAttachment()],
});

const SHIPPING_STATUS_COPY = {
  'on process': {
    title: 'Pesanan Sedang Diproses',
    headline: 'Pesanan Anda sedang kami siapkan.',
    body: 'Tim IOM ITB sedang menyiapkan pesanan Anda dan akan segera dikirim.',
  },
  'on delivery': {
    title: 'Pesanan Dalam Pengiriman',
    headline: 'Pesanan Anda sudah dalam perjalanan!',
    body: 'Pesanan akan tiba sesuai alamat pengiriman yang Anda berikan. Mohon tunggu beberapa hari kerja.',
  },
  arrived: {
    title: 'Pesanan Telah Tiba',
    headline: 'Pesanan Anda telah sampai di tujuan.',
    body: 'Mohon konfirmasi penerimaan pesanan. Terima kasih atas kepercayaan Anda kepada IOM ITB.',
  },
  done: {
    title: 'Pesanan Selesai',
    headline: 'Pesanan Anda telah selesai.',
    body: 'Terima kasih telah berbelanja di IOM ITB. Semoga produk kami bermanfaat untuk Anda.',
  },
  canceled: {
    title: 'Pesanan Dibatalkan',
    headline: 'Pesanan Anda telah dibatalkan.',
    body: 'Jika ada pertanyaan terkait pembatalan ini, mohon hubungi tim IOM ITB.',
  },
  denied: {
    title: 'Pesanan Ditolak',
    headline: 'Pesanan Anda tidak dapat kami proses.',
    body: 'Jika ada pertanyaan, mohon hubungi tim IOM ITB untuk informasi lebih lanjut.',
  },
};

const buildTransactionShippingStatusEmail = ({ username, code, merchandiseName, qty, address, notes, status, transactionId, orderStatusToken, orderStatusUrl }) => {
  const copy = SHIPPING_STATUS_COPY[status] || {
    title: 'Update Status Pesanan',
    headline: `Status pesanan Anda diperbarui menjadi: ${status}`,
    body: 'Cek detail pesanan Anda untuk informasi lebih lanjut.',
  };
  return {
    subject: `${copy.title} — IOM ITB`,
    html: `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="cid:${LOGO_CID}" alt="IOM ITB" style="max-width:180px;height:auto;" />
  </div>
  <h2 style="color:#1d4ed8;margin-bottom:4px;">IOM ITB</h2>
  <p style="color:#6b7280;margin-top:0;">${copy.title}</p>
  <div style="height:1px;background:#e5e7eb;margin:16px 0;"></div>
  <p>Halo <strong>${username}</strong>,</p>
  <p><strong>${copy.headline}</strong></p>
  <p>${copy.body}</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:8px 0;color:#6b7280;">Kode Pesanan</td><td style="padding:8px 0;font-weight:bold;">${code}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;">Produk</td><td style="padding:8px 0;">${merchandiseName} x ${qty}</td></tr>
    ${notes ? `<tr><td style="padding:8px 0;color:#6b7280;vertical-align:top;">Catatan</td><td style="padding:8px 0;white-space:pre-line;">${escapeHtml(notes)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;color:#6b7280;">Status Saat Ini</td><td style="padding:8px 0;font-weight:bold;color:#1d4ed8;text-transform:capitalize;">${status}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;">Alamat Pengiriman</td><td style="padding:8px 0;">${address}</td></tr>
  </table>
  ${renderOrderStatusCta(orderStatusUrl || buildOrderStatusUrl(orderStatusToken))}
  <p style="color:#6b7280;font-size:13px;margin-top:24px;">Salam,<br><strong>IOM ITB</strong></p>
</div>`,
    attachments: [logoAttachment()],
  };
};

module.exports = {
  buildDonationPaymentEmail,
  buildTransactionPaymentEmail,
  buildTransactionProofReceivedEmail,
  buildTransactionShippingStatusEmail,
  SHIPPING_STATUS_COPY,
};
