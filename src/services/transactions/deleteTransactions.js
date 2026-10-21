const { Transactions, TransactionItems, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const fs = require('fs');
const path = require('path');
const BaseError = require('../../schemas/responses/BaseError');
const { releaseOrderStock } = require('./orderItems');

const DeleteTransactions = async (id) => {
  const transaction = await sequelize.transaction(); // Start a transaction
  try {
    // Find transaction by id
    const transactionRecord = await Transactions.findByPk(id, { transaction });

    // If transaction not found, throw an error
    if (!transactionRecord) {
      throw {
        status: StatusCodes.NOT_FOUND,
        message: 'Transaction not found',
      };
    }

    if (transactionRecord.stockDeducted) {
      await releaseOrderStock(transactionRecord, transaction);
    }

    if (transactionRecord.payment) {
      const previousImageFileName = path.basename(transactionRecord.payment);
      const previousImageFilePath = path.join(__dirname, '../../uploads', previousImageFileName);

      if (fs.existsSync(previousImageFilePath)) {
        fs.unlinkSync(previousImageFilePath);
      }
    }

    // Delete the transaction (beserta item pesanannya)
    await TransactionItems.destroy({ where: { transactionId: transactionRecord.id }, transaction });
    await transactionRecord.destroy({ transaction });

    // Commit the transaction
    await transaction.commit();

    return {
      status: StatusCodes.OK,
      message: 'Transaction deleted successfully',
    };
  } catch (error) {
    // Rollback the transaction in case of error
    await transaction.rollback();
    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to delete transaction: ${error.message || error}`,
    });
  }
};

module.exports = DeleteTransactions;
