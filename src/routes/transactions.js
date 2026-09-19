const { Router } = require('express');
const {
  GetTransactionById,
  GetTransactionByPublicToken,
  GetAllTransaction,
  CreateNewTransaction,
  UpdateTransactionById,
  ConfirmTransactionPayment,
  DeleteTransactionById,
} = require('../controllers/transactions'); // Updated to 'transaction'
const upload = require('../middlewares/multer');
const JWTValidation = require('../middlewares/auth');
const requireRoles = require('../middlewares/requireRoles');
const { FINANCE_ROLES } = require('../utils/roles');

const router = Router();
const canManageTransactions = [JWTValidation, requireRoles(FINANCE_ROLES)];

router.get('', canManageTransactions, GetAllTransaction); // Updated to 'GetAllTransaction'
router.get('/public/:token', [], GetTransactionByPublicToken);
router.get('/:id', canManageTransactions, GetTransactionById); // Updated to 'GetTransactionById'
router.post('', upload.fields([{ name: 'payment', maxCount: 1 }]), CreateNewTransaction); // Updated to 'CreateNewTransaction'
router.put('/:id', canManageTransactions, upload.fields([{ name: 'payment', maxCount: 1 }]), UpdateTransactionById); // Updated to 'UpdateTransactionById'
router.post('/:id/confirm-payment', canManageTransactions, ConfirmTransactionPayment);
router.delete('/:id', canManageTransactions, DeleteTransactionById); // Updated to 'DeleteTransactionById'

module.exports = router;
