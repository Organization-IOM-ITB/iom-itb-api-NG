/**
 * @swagger
 *
 * /payments/snap-token:
 *   post:
 *     summary: Create Midtrans SNAP token
 *     tags: [Payments]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *               - grossAmount
 *             properties:
 *               orderId:
 *                 type: string
 *                 example: TRX-001
 *               grossAmount:
 *                 type: number
 *                 example: 100000
 *               firstName:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: SNAP token created
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Internal Server Error
 *
 * /payments/notification:
 *   post:
 *     summary: Handle Midtrans payment notification
 *     tags: [Payments]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Notification handled
 *       500:
 *         description: Internal Server Error
 *
 * /payments/verify:
 *   post:
 *     summary: Verify payment status
 *     tags: [Payments]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Internal Server Error
 *
 * /payments/cancel:
 *   post:
 *     summary: Cancel payment
 *     tags: [Payments]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderId:
 *                 type: string
 *               publicToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment cancelled
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Internal Server Error
 */
