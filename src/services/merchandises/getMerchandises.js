const { Merchandises } = require('../../models');
const { Op } = require('sequelize');

// Tambahkan parameter id untuk pengecekan spesifik merchandise
const GetMerchandises = async ({ id = null, search = '', page = 1, limit = 5 }) => {
  // Jika id disediakan, kembalikan merchandise berdasarkan id
  if (id) {
    // Kegagalan dilempar, bukan dikembalikan sebagai objek pesan. Mengembalikan
    // { message } membuat controller menganggapnya sukses dan membalas HTTP 200
    // dengan bentuk data yang salah.
    const numericId = Number.parseInt(id, 10);
    if (!Number.isInteger(numericId) || String(numericId) !== String(id).trim()) {
      const error = new Error(`Id merchandise tidak valid: ${id}`);
      error.status = 400;
      throw error;
    }

    return Merchandises.findByPk(numericId);
  }  

  // Logika untuk pencarian semua merchandise
  const pageNumber = parseInt(page) || 1;
  const pageLimit = parseInt(limit);
  const offset = (pageNumber - 1) * pageLimit;
  
  const options = {
    where: {},
    limit: pageLimit,
    offset,
    order: [['createdAt', 'DESC']],  // Urutkan berdasarkan tanggal dibuat secara descending
  };

  // Jika ada pencarian, gunakan filter nama merchandise
  if (search) {
    options.where.name = { [Op.like]: `%${search}%` };
  }

  try {
    const { rows, count } = await Merchandises.findAndCountAll(options);

    return {
      data: rows,
      total: count,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
    };
  } catch (error) {
    throw new Error(`Gagal mengambil data merchandise: ${error.message}`);
  }
};

module.exports = GetMerchandises;
