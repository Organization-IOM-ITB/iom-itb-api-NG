'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Transactions', 'shippingCost', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('Transactions', 'shippingZone', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Transactions', 'shippingZone');
    await queryInterface.removeColumn('Transactions', 'shippingCost');
  },
};
