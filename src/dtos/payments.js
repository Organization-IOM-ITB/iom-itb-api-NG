const MIDTRANS_TO_PAYMENT_STATUS = {
  settlement: 'settlement',
  expire: 'expired',
  cancel: 'failed',
  deny: 'failed',
  refund: 'refunded',
  partial_refund: 'refunded',
};

const DONATION_TYPE_LABEL = {
  iuran_sukarela: 'Iuran Sukarela',
  kontribusi_anggota: 'Kontribusi Anggota',
  kontribusi_donatur: 'Kontribusi Donatur',
  pembelian_merchandise: 'Pembelian Merchandise',
  kontribusi_sukarela: 'Kontribusi Sukarela',
};

const toNumber = (value) => {
  if (value == null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const titleCase = (value) => String(value || '')
  .split(/[_\s-]+/)
  .filter(Boolean)
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  .join(' ');

class PaymentNotificationDto {
  constructor(data = {}) {
    this.orderId = data.orderId;
    this.scope = data.scope || PaymentNotificationDto.scopeFromOrderId(data.orderId);
    this.transactionId = data.transactionId || null;
    this.paymentStatus = data.paymentStatus || 'pending';
    this.transactionStatus = data.transactionStatus || null;
    this.fraudStatus = data.fraudStatus || null;
    this.grossAmount = toNumber(data.grossAmount);
    this.paymentType = data.paymentType || null;
    this.vaNumber = data.vaNumber || null;
    this.paidAt = data.paidAt || null;
    this.isPaid = Boolean(data.isPaid);
    this.isFailed = Boolean(data.isFailed);
    this.raw = data.raw || null;
  }

  validate() {
    if (!this.orderId || typeof this.orderId !== 'string') {
      throw new Error('orderId is required.');
    }
    if (!Number.isFinite(this.grossAmount)) {
      throw new Error('grossAmount must be a valid number.');
    }
    return true;
  }

  static mapPaymentStatus(transactionStatus, fraudStatus) {
    if (transactionStatus === 'capture') {
      return fraudStatus === 'accept' ? 'settlement' : 'pending';
    }
    return MIDTRANS_TO_PAYMENT_STATUS[transactionStatus] || 'pending';
  }

  static scopeFromOrderId(orderId) {
    if (!orderId) return 'unknown';
    if (orderId.startsWith('DONATION-')) return 'donation';
    if (orderId.startsWith('IOM-')) return 'transaction';
    return 'unknown';
  }

  static fromMidtransRaw(raw = {}) {
    const paymentStatus = PaymentNotificationDto.mapPaymentStatus(
      raw.transaction_status,
      raw.fraud_status
    );
    const isPaid = paymentStatus === 'settlement';
    const isFailed = paymentStatus === 'failed' || paymentStatus === 'expired';
    const vaNumber = Array.isArray(raw.va_numbers) && raw.va_numbers[0]
      ? raw.va_numbers[0].va_number
      : null;

    const dto = new PaymentNotificationDto({
      orderId: raw.order_id,
      scope: PaymentNotificationDto.scopeFromOrderId(raw.order_id),
      transactionId: raw.transaction_id,
      paymentStatus,
      transactionStatus: raw.transaction_status,
      fraudStatus: raw.fraud_status,
      grossAmount: raw.gross_amount,
      paymentType: raw.payment_type,
      vaNumber,
      paidAt: isPaid ? (raw.settlement_time ? new Date(raw.settlement_time) : new Date()) : null,
      isPaid,
      isFailed,
      raw,
    });

    dto.validate();
    return dto;
  }
}

class DonationDto {
  constructor(data = {}) {
    this.id = data.id;
    this.name = data.name;
    this.email = data.email || null;
    this.noWhatsapp = data.noWhatsapp || null;
    this.notification = DonationDto.normalizeNotification(data.notification);
    this.donationType = data.donationType || null;
    this.facultyId = data.facultyId != null ? Number(data.facultyId) : undefined;
    this.midtransOrderId = data.midtransOrderId || null;
    this.paymentMethod = data.paymentMethod || null;
    this.paymentStatus = data.paymentStatus || null;
    this.amount = toNumber(data.amount);
    this.grossAmount = toNumber(data.grossAmount);
    this.paidAt = data.paidAt || null;
    this.date = data.date || null;
    this.updatedAt = data.updatedAt || null;
    this.createdAt = data.createdAt || null;
  }

  validate() {
    if (!this.id) {
      throw new Error('Donation id is required.');
    }
    if (!this.name) {
      throw new Error('Donation name is required.');
    }
    return true;
  }

  static normalizeNotification(notification) {
    if (Array.isArray(notification)) return notification;
    if (notification && typeof notification === 'object') {
      return Object.keys(notification).filter((key) => notification[key]);
    }
    return [];
  }

  static prettifyDonationType(value) {
    if (!value) return 'Umum';
    return DONATION_TYPE_LABEL[value] || titleCase(value);
  }

  static fromModel(donation) {
    const optionBag = donation?.options && typeof donation.options === 'object' ? donation.options : {};
    const dto = new DonationDto({
      id: donation.id,
      name: donation.name,
      email: donation.email,
      noWhatsapp: donation.noWhatsapp,
      notification: donation.notification,
      donationType: donation.donationType || optionBag.donationType,
      facultyId: donation.facultyId != null ? donation.facultyId : optionBag.facultyId,
      midtransOrderId: donation.midtransOrderId,
      paymentMethod: donation.paymentMethod,
      paymentStatus: donation.paymentStatus,
      amount: donation.amount,
      grossAmount: donation.grossAmount,
      paidAt: donation.paidAt || donation.date || null,
      date: donation.date || null,
      updatedAt: donation.updatedAt,
      createdAt: donation.createdAt,
    });

    dto.validate();
    return dto;
  }

  getNotificationChannels() {
    const whatsapp = this.notification.includes('Whatsapp')
      || this.notification.includes('WhatsApp')
      || this.notification.includes('whatsapp');
    const email = this.notification.includes('Email') || this.notification.includes('email');

    let describe = 'kontak yang Anda daftarkan';
    if (whatsapp && email) describe = 'WhatsApp dan Email Anda';
    else if (whatsapp) describe = 'WhatsApp Anda';
    else if (email) describe = 'Email Anda';

    return { whatsapp, email, describe };
  }

  getFormattedDonationType() {
    return DonationDto.prettifyDonationType(this.donationType);
  }

  getGrossAmount() {
    return this.grossAmount != null ? this.grossAmount : this.amount;
  }

  getInvoiceId() {
    return this.midtransOrderId || `DON-${this.id}`;
  }

  toPaymentConfirmationPayload(transactionId) {
    return {
      name: this.name,
      amount: Number(this.getGrossAmount() || 0).toLocaleString('id-ID'),
      donationType: this.getFormattedDonationType(),
      transactionId,
    };
  }

  toInvoiceRows(facultyName = '-') {
    return [
      { label: 'ID Donasi', value: this.getInvoiceId() },
      { label: 'Tanggal', value: this.date || this.updatedAt },
      { label: 'Metode Pembayaran', value: 'Midtrans' },
      { label: 'Nama Donatur', value: this.name || '-' },
      { label: 'Email', value: this.email || '-' },
      { label: 'No. WhatsApp', value: this.noWhatsapp || '-' },
      { label: 'Jenis Donasi', value: this.getFormattedDonationType() },
      { label: 'Fakultas', value: facultyName },
    ];
  }
}

class TransactionDto {
  constructor(data = {}) {
    this.id = data.id;
    this.username = data.username;
    this.email = data.email || null;
    this.noTelp = data.noTelp || null;
    this.address = data.address;
    this.merchandiseId = data.merchandiseId;
    this.merchandiseName = data.merchandiseName || null;
    this.qty = Number(data.qty || 0);
    this.code = data.code || null;
    this.notes = data.notes || null;
    this.publicToken = data.publicToken || null;
    this.midtransOrderId = data.midtransOrderId || null;
    this.paymentMethod = data.paymentMethod || null;
    this.paymentStatus = data.paymentStatus || null;
    this.status = data.status || null;
    this.grossAmount = toNumber(data.grossAmount);
    this.paidAt = data.paidAt || null;
    this.stockDeducted = Boolean(data.stockDeducted);
    this.updatedAt = data.updatedAt || null;
    this.createdAt = data.createdAt || null;
  }

  validate() {
    if (!this.id) {
      throw new Error('Transaction id is required.');
    }
    if (!this.username) {
      throw new Error('Transaction username is required.');
    }
    return true;
  }

  static fromModel(trx) {
    const dto = new TransactionDto({
      id: trx.id,
      username: trx.username,
      email: trx.email,
      noTelp: trx.noTelp,
      address: trx.address,
      merchandiseId: trx.merchandiseId,
      merchandiseName: trx.merchandiseName || trx.merchandises?.name,
      qty: trx.qty,
      code: trx.code,
      notes: trx.notes,
      publicToken: trx.publicToken,
      midtransOrderId: trx.midtransOrderId,
      paymentMethod: trx.paymentMethod,
      paymentStatus: trx.paymentStatus,
      status: trx.status,
      grossAmount: trx.grossAmount,
      paidAt: trx.paidAt || null,
      stockDeducted: trx.stockDeducted,
      updatedAt: trx.updatedAt,
      createdAt: trx.createdAt,
    });

    dto.validate();
    return dto;
  }

  getOrderCode() {
    return this.code || this.midtransOrderId || `TRX-${this.id}`;
  }

  getGrossAmount(unitPrice = 0) {
    return this.grossAmount != null ? this.grossAmount : Number(unitPrice || 0) * this.qty;
  }

  toPaymentConfirmationPayload(transactionId) {
    return {
      username: this.username,
      code: this.getOrderCode(),
      merchandiseName: this.merchandiseName || 'Merchandise',
      qty: this.qty,
      notes: this.notes || '',
      amount: Number(this.getGrossAmount() || 0).toLocaleString('id-ID'),
      transactionId,
      orderStatusToken: this.publicToken,
    };
  }

  toInvoiceRows({ merchandiseName, unitPrice }) {
    return [
      { label: 'Kode Transaksi', value: this.getOrderCode() },
      { label: 'Tanggal', value: this.updatedAt || this.createdAt },
      { label: 'Metode Pembayaran', value: 'Midtrans' },
      { label: 'Nama Pembeli', value: this.username || '-' },
      { label: 'Email', value: this.email || '-' },
      { label: 'No. Telp', value: this.noTelp || '-' },
      { label: 'Alamat Pengiriman', value: this.address || '-' },
      { label: 'Produk', value: merchandiseName },
      // Catatan pembeli ditempatkan langsung di bawah Produk, konsisten
      // dengan email status pesanan.
      ...(this.notes ? [{ label: 'Catatan', value: this.notes }] : []),
      { label: 'Harga Satuan', value: unitPrice },
      { label: 'Jumlah', value: `${this.qty} pcs` },
    ];
  }
}

module.exports = {
  PaymentNotificationDto,
  DonationDto,
  TransactionDto,
  DONATION_TYPE_LABEL,
};
