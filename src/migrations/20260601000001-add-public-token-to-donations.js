'use strict';

const crypto = require('crypto');

const generateToken = () => `ord_${crypto.randomBytes(24).toString('base64url')}`;

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const desc = await queryInterface.describeTable('Donations');

    if (!desc.publicToken) {
      await queryInterface.addColumn('Donations', 'publicToken', {
        type: Sequelize.STRING(80),
        allowNull: true,
      });
    }

    const [donations] = await queryInterface.sequelize.query(
      'SELECT id FROM `Donations` WHERE publicToken IS NULL'
    );

    const usedTokens = new Set();
    for (const donation of donations) {
      let token = generateToken();
      while (usedTokens.has(token)) token = generateToken();
      usedTokens.add(token);
      await queryInterface.bulkUpdate('Donations', { publicToken: token }, { id: donation.id });
    }

    const indexes = await queryInterface.showIndex('Donations');
    const hasIndex = indexes.some((i) => i.name === 'donations_public_token_unique');
    if (!hasIndex) {
      await queryInterface.addIndex('Donations', ['publicToken'], {
        name: 'donations_public_token_unique',
        unique: true,
      });
    }

    await queryInterface.changeColumn('Donations', 'publicToken', {
      type: Sequelize.STRING(80),
      allowNull: false,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('Donations', 'donations_public_token_unique');
    await queryInterface.removeColumn('Donations', 'publicToken');
  },
};
