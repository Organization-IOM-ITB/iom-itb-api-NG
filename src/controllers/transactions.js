const { StatusCodes } = require('http-status-codes');
const BaseResponse = require('../schemas/responses/BaseResponse');
const DataTable = require('../schemas/responses/DataTable');
const CreateTransaction = require('../services/transactions/createTransactions');
const GetTransaction = require('../services/transactions/getTransactions');
const UpdateTransaction = require('../services/transactions/updateTransactions'); // Fixed the function name
const DeleteTransaction = require('../services/transactions/deleteTransactions'); // Fixed the function name
const ConfirmManualPayment = require('../services/transactions/confirmManualPayment');

const GetTransactionById = async (req, res) => {
  try {
    const { id } = req.params; // Mendapatkan id dari parameter URL
    const transaction = await GetTransaction({ id: id }); // Mengambil detail transaction berdasarkan ID

    // Jika transaction tidak ditemukan, kembalikan respon 404
    if (!transaction) {
      return res.status(StatusCodes.NOT_FOUND).json(new BaseResponse({
        status: StatusCodes.NOT_FOUND,
        message: 'Transaction tidak ditemukan',
      }));
    }

    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'Transaction ditemukan',
      data: transaction,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message || 'Terjadi kesalahan saat mengambil transaction',
    }));
  }
};

const GetTransactionByPublicToken = async (req, res) => {
  try {
    const { token } = req.params;
    const transaction = await GetTransaction({ publicToken: token });

    if (!transaction) {
      return res.status(StatusCodes.NOT_FOUND).json(new BaseResponse({
        status: StatusCodes.NOT_FOUND,
        message: 'Status pesanan tidak ditemukan',
      }));
    }

    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'Status pesanan ditemukan',
      data: transaction.data,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message || 'Terjadi kesalahan saat mengambil status pesanan',
    }));
  }
};

const GetTransactionByCode = async (req, res) => {
  try { // Mendapatkan code dari parameter URL
    const transaction = await GetTransaction({ code: code }); // Mengambil detail transaction berdasarkan code

    // Jika transaction tidak ditemukan, kembalikan respon 404
    if (!transaction) {
      return res.status(StatusCodes.NOT_FOUND).json(new BaseResponse({
        status: StatusCodes.NOT_FOUND,
        message: 'Transaction tidak ditemukan',
      }));
    }

    // Kembalikan data transaction jika ditemukan
    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'Transaction ditemukan',
      data: transaction,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message || 'Terjadi kesalahan saat mengambil transaction',
    }));
  }
};

const GetAllTransaction = async (req, res) => {
  try {
    const { search } = req.query;
    const code = req.query.q;

    const transactions = await GetTransaction({ code }, req.query, search);

    if (code) {
      return res.status(StatusCodes.OK).json(new DataTable(transactions.data, transactions.total));
    }

    const pageNumber = parseInt(req.query.page, 10) || 1;
    const pageLimit = parseInt(req.query.limit, 10) || 10;
    const totalEntries = transactions.total || 0;
    const totalPages = Math.ceil(totalEntries / pageLimit);
    const start = totalEntries === 0 ? 0 : (pageNumber - 1) * pageLimit + 1;
    const end = Math.min(pageNumber * pageLimit, totalEntries);

    res.status(StatusCodes.OK).json({
      data: transactions.data,
      total: totalEntries,
      pagination: {
        currentPage: pageNumber,
        totalPages,
        start,
        end,
        totalEntries,
      },
    });
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message,
    }));
  }
};

// Create new transaction
const CreateNewTransaction = async (req, res) => {
  try {
    const { body, files } = req; // Data yang dikirim dari client (request body)
    const baseUrl = `${req.protocol}://${req.get('host')}`; 
    const newTransaction = await CreateTransaction(body, files, baseUrl);

    res.status(StatusCodes.CREATED).json(new BaseResponse({
      status: StatusCodes.CREATED,
      message: 'Transaction created successfully',
      data: newTransaction,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message || 'Failed to create transaction',
    }));
  }
};

// Update transaction by ID
const UpdateTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    const { body, files } = req;
    const baseUrl = `${req.protocol}://${req.get('host')}`; 
    const updatedTransaction = await UpdateTransaction(id, body, files, baseUrl);

    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: 'Transaction berhasil diperbarui',
      data: updatedTransaction,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message,
    }));
  }
};

// Confirm manual (bank transfer) payment after admin reviews the proof
const ConfirmTransactionPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await ConfirmManualPayment(id);
    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: result.message,
      data: result.data,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message,
    }));
  }
};

// Delete transaction by ID
const DeleteTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await DeleteTransaction(id);
    res.status(StatusCodes.OK).json(new BaseResponse({
      status: StatusCodes.OK,
      message: result.message,
    }));
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(new BaseResponse({
      status,
      message: error.message,
    }));
  }
};

module.exports = {
  GetTransactionById,
  GetTransactionByPublicToken,
  GetTransactionByCode,
  GetAllTransaction,
  CreateNewTransaction,
  UpdateTransactionById,
  ConfirmTransactionPayment,
  DeleteTransactionById,
};
