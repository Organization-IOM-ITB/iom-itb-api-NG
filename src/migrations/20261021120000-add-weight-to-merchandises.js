'use strict';

// Ongkir berbasis berat: Merchandises.weight (gram, termasuk kemasan) dan
// Transactions.shippingWeight (total berat pesanan, gram).
//
// Berat awal produk yang sudah ada = perkiraan umum (bisa diubah admin):
// cocokkan id + nama agar tidak salah isi di database lain.
const INITIAL_WEIGHTS = [
  // [id, pola nama, gram]
  [4, 'Tumbler%', 500], // tumbler stainless + kotak
  [5, 'Tumbler%', 500],
  [6, 'Tumbler%', 500],
  [7, 'Tumbler%', 500],
  [8, 'Tumbler%', 350], // tumbler kecil
  [9, 'Jersey%', 250], // jersey 120–130 gsm + plastik
  [12, 'Jersey%', 250],
  [15, 'Hijab%', 200],
  [16, 'Agenda%', 450], // agenda hardcover
  [17, 'Tas Lipat%', 150],
  [18, 'Kartu E-Money%', 50],
  [19, 'Stiker%', 50],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Merchandises', 'weight', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('Transactions', 'shippingWeight', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    for (const [id, namePattern, grams] of INITIAL_WEIGHTS) {
      await queryInterface.sequelize.query(
        'UPDATE Merchandises SET weight = ? WHERE id = ? AND name LIKE ? AND weight IS NULL',
        { replacements: [grams, id, namePattern] }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Transactions', 'shippingWeight');
    await queryInterface.removeColumn('Merchandises', 'weight');
  },
};
