const { Router } = require('express');
const {
  getMe,
  getApps,
  selectApp,
  registerUser,
  updateUserRole,
  updateUserEnabled,
  deleteUser,
} = require('../controllers/ssoAuth');
const router = Router();
const JWTValidation = require('../middlewares/auth');
const apiKeyAuth = require('../middlewares/apiKeyAuth');

router.get('/me', JWTValidation, getMe);
router.get('/apps', JWTValidation, getApps);
router.post('/select', JWTValidation, selectApp);
router.post('/register', apiKeyAuth, registerUser);
router.patch('/users/:id/role', apiKeyAuth, updateUserRole);
router.patch('/users/:id/enabled', apiKeyAuth, updateUserEnabled);
router.delete('/users/:id', apiKeyAuth, deleteUser);

module.exports = router;
