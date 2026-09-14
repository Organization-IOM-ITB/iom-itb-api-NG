const { Router } = require('express');
const {
  GetMerchandiseById,
  GetAllMerchandise,
  GetMerchandiseCategories,
  CreateMerchandiseCategory,
  UpdateMerchandiseCategory,
  CreateNewMerchandise,
  UpdateMerchandiseById,
  DeleteMerchandiseById,
  DeleteMerchandiseCategory,
} = require('../controllers/merchandises');
const upload  = require('../middlewares/multer');
const JWTValidation = require('../middlewares/auth');
const requireRoles = require('../middlewares/requireRoles');
const { FINANCE_ROLES } = require('../utils/roles');

const router = Router();
const canManageMerchandise = [JWTValidation, requireRoles(FINANCE_ROLES)];

router.get('/categories', canManageMerchandise, GetMerchandiseCategories);
router.post('/categories', canManageMerchandise, CreateMerchandiseCategory);
router.put('/categories/:category', canManageMerchandise, UpdateMerchandiseCategory);
router.delete('/categories/:category', canManageMerchandise, DeleteMerchandiseCategory);

router.get('', [], GetAllMerchandise);
// Listing untuk dashboard admin. Harus dideklarasikan sebelum '/:id' agar tidak
// tertangkap sebagai id, dan dilindungi role karena dipakai halaman internal.
router.get('/internal', canManageMerchandise, GetAllMerchandise);
router.get('/:id', [], GetMerchandiseById);
router.post('', canManageMerchandise, [], CreateNewMerchandise);
router.put('/:id', canManageMerchandise, [], UpdateMerchandiseById);
router.delete('/:id', canManageMerchandise, [], DeleteMerchandiseById);

module.exports = router;
