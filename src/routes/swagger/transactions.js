/**
 * @swagger
 *
 * /transactions:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Get all transactions
 *     tags: [Transactions]
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           example: 1
 *       - in: query
 *         name: length
 *         required: false
 *         schema:
 *           type: integer
 *           example: 10
 *       - in: query
 *         name: search
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of transactions
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 *
 *   post:
 *     summary: Create new transaction
 *     tags: [Transactions]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - username
 *               - email
 *             properties:
 *               code:
 *                 type: string
 *                 example: TRX001
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *               noTelp:
 *                 type: string
 *               address:
 *                 type: string
 *               items:
 *                 type: string
 *                 description: >
 *                   Isi keranjang (string JSON):
 *                   [{"merchandiseId":1,"qty":2,"selectedOptions":{"Size":"XL"}}].
 *                   Bila kosong, dipakai merchandiseId + qty + selectedOptions (satu produk).
 *                 example: '[{"merchandiseId":1,"qty":2,"selectedOptions":{"Size":"XL"}}]'
 *               merchandiseId:
 *                 type: string
 *               qty:
 *                 type: integer
 *               paymentMethod:
 *                 type: string
 *               payment:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Transaction created
 *       500:
 *         description: Internal Server Error
 *
 * /transactions/public/{token}:
 *   get:
 *     summary: Get transaction by public token
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction detail
 *       404:
 *         description: Not found
 *       500:
 *         description: Internal Server Error
 *
 * /transactions/{id}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     summary: Get transaction by ID
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction detail
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 *
 *   put:
 *     security:
 *       - bearerAuth: []
 *     summary: Update transaction
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *               paymentStatus:
 *                 type: string
 *               payment:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Transaction updated
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 *
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     summary: Delete transaction
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction deleted
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Internal Server Error
 */