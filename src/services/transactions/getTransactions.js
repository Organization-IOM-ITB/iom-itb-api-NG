const { Transactions, Merchandises } = require('../../models');
const { Op } = require('sequelize');

const maskEmail = (email) => {
  if (!email || !String(email).includes('@')) return email || null;
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(name.length - 2, 2))}@${domain}`;
};

const maskPhone = (phone) => {
  if (!phone) return null;
  const value = String(phone);
  if (value.length <= 6) return value;
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(value.length - 7, 3))}${value.slice(-3)}`;
};

const toPublicTransaction = (transaction) => {
  const plain = transaction.toJSON();

  return {
    code: plain.code,
    username: plain.username,
    email: maskEmail(plain.email),
    noTelp: maskPhone(plain.noTelp),
    address: plain.address,
    notes: plain.notes,
    merchandiseId: plain.merchandiseId,
    merchandises: plain.merchandises ? {
      name: plain.merchandises.name,
      image: plain.merchandises.image,
      price: plain.merchandises.price,
    } : null,
    qty: plain.qty,
    paymentMethod: plain.paymentMethod,
    paymentStatus: plain.paymentStatus,
    status: plain.status,
    grossAmount: plain.grossAmount,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

// Add an id parameter for specific transaction checks
const GetTransactions = async (key, query = {}, search = '') => {
  // If id is provided, return the transaction by id
  if (key?.id) {
    try {
      const transaction = await Transactions.findByPk(key.id, {
        include: {
          model: Merchandises,
          as: 'merchandises',
          // Remove the attributes option to include all fields
        },
      });

      if (!transaction) {
        throw new Error(`Transaction with id ${key.id} not found`);
      }
      return { data: transaction }; // Return transaction details
    } catch (error) {
      throw new Error(`Failed to retrieve transaction data: ${error.message}`);
    }
  }

  if (key?.publicToken) {
    try {
      const transaction = await Transactions.findOne({
        where: { publicToken: key.publicToken },
        include: {
          model: Merchandises,
          as: 'merchandises',
          attributes: ['name', 'image', 'price'],
        },
      });

      if (!transaction) {
        const error = new Error('Order status link is invalid or expired');
        error.status = 404;
        throw error;
      }

      return { data: toPublicTransaction(transaction) };
    } catch (error) {
      if (error.status) throw error;
      throw new Error(`Failed to retrieve order status: ${error.message}`);
    }
  }

  // If transaction code is provided, search by transaction code
  if (key?.code) {
    try {
      const transaction = await Transactions.findOne({
        where: { code: key.code },
        include: {
          model: Merchandises,
          as: 'merchandises',
          // Remove the attributes option to include all fields
        },
      });
      if (!transaction) {
        throw new Error(`Transaction with code ${key.code} not found`);
      }
      
      return { data: transaction };  // Return transaction details
    } catch (error) {
      throw new Error(`Failed to retrieve transaction data: ${error.message}`);
    }
  }

  // Logic for retrieving all transactions
  const page = parseInt(query.page, 10) || 1;  // Get page value from query params (default 1)
  const limit = parseInt(query.limit, 10) || 10;  // Get limit value from query params (default 10)
  const offset = (page - 1) * limit;  // Calculate offset based on page and limit

  const options = {
    where: {},
    limit,
    offset,
    order: [['createdAt', 'DESC']],  // Order by creation date descending
    include: {
      model: Merchandises,
      as: 'merchandises',
      // Remove the attributes option to include all fields
    },
  };

  if (query.status) {
    options.where.status = query.status;
  }

  if (query.paymentMethod) {
    options.where.paymentMethod = query.paymentMethod;
  }

  if (query.paymentStatus) {
    options.where.paymentStatus = query.paymentStatus;
  }

  const searchKeyword = search || query.search;

  if (searchKeyword) {
    options.where[Op.or] = [
      { code: { [Op.like]: `%${searchKeyword}%` } },
      { username: { [Op.like]: `%${searchKeyword}%` } },
      { email: { [Op.like]: `%${searchKeyword}%` } },
      { noTelp: { [Op.like]: `%${searchKeyword}%` } },
      { '$merchandises.name$': { [Op.like]: `%${searchKeyword}%` } },
    ];
  }

  try {
    const { rows, count } = await Transactions.findAndCountAll(options);

    return {
      data: rows,
      total: count,
      currentPage: page,
      totalPages: Math.ceil(count / limit),
    };
  } catch (error) {
    throw new Error(`Failed to retrieve transaction data: ${error.message}`);
  }
};

module.exports = GetTransactions;
