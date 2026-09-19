const { Merchandises, sequelize } = require('../../models');
const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');
const fs = require('fs');
const path = require('path');

const UpdateMerchandises = async (id, body) => {
  const transaction = await sequelize.transaction();

  try {
    const merchandise = await Merchandises.findByPk(id, { transaction });

    if (!merchandise) {
      throw new BaseError({
        status: StatusCodes.NOT_FOUND,
        message: 'Merchandise not found',
      });
    }

    const { name, price, stock, image, link, kategori, hpp } = body;

    if (!name && !price && !stock && !image && !link && hpp === undefined) {
      throw new BaseError({
        status: StatusCodes.BAD_REQUEST,
        message: 'At least one of name, price, stock or image must be provided for update',
      });
    }

    // Update merchandise with new data
    const updatedMerchandise = await Merchandises.update(
      {
        name: name || merchandise.name,
        image: image || merchandise.image,
        description: body.description || merchandise.description,
        price: price !== undefined ? price : merchandise.price,
        stock: stock !== undefined ? stock : merchandise.stock,
        link: link ? link : merchandise.link,
        kategori: kategori !== undefined ? kategori : merchandise.kategori,
        hpp: hpp !== undefined ? hpp : merchandise.hpp,
      },
      {
        where: { id },
        transaction,
      }
    );

    await transaction.commit();

    return updatedMerchandise;
  } catch (error) {
    await transaction.rollback();

    throw new BaseError({
      status: error.status || StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to update merchandise: ${error.message || error}`,
    });
  }
};

module.exports = UpdateMerchandises;
