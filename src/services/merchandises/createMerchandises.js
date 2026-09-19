const { Merchandises, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');

const CreateMerchandises = async (body) => {
  // Start transaction
  const transaction = await sequelize.transaction();

  try {
    // Validate required fields
    const { name, price, stock, image, link, kategori, hpp } = body;

    if (!name || !price || !stock) {
      throw new BaseError({
        status: StatusCodes.BAD_REQUEST,
        message: 'Name, price, and stock are required fields',
      });
    }

    // Create the merchandise record within a transaction
    const newMerchandise = await Merchandises.create(
      {
        name,
        image: image, // store the file name in the database or null if no image
        description: body.description || '', // optional
        price,
        stock,
        link,
        kategori: kategori || null,
        hpp: hpp || 0,
      },
      { transaction }
    );

    // Commit the transaction
    await transaction.commit();

    return newMerchandise;
  } catch (error) {
    // Rollback the transaction in case of error
    await transaction.rollback();

    // Re-throw the error for handling
    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to create merchandise: ${error.message || error}`,
    });
  }
};

module.exports = CreateMerchandises;
