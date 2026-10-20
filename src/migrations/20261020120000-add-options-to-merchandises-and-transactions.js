'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Merchandises', 'options', {
      type: Sequelize.JSON,
      allowNull: true,
    });
    await queryInterface.addColumn('Transactions', 'selectedOptions', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Transactions', 'selectedOptions');
    await queryInterface.removeColumn('Merchandises', 'options');
  },
};
