const { Router } = require('express');
const {
  GetActivityBySlug,
  GetAllActivities,
  GetAllActivitiesAdmin,
  CreateNewActivity,
  UpdateActivityById,
  DeleteActivityById,
  GetActivityById,
  GetActivityCounts,
  GetAllTags,
  GetAllContributors
} = require('../controllers/activities');
const JWTValidation = require('../middlewares/auth');
const requireRoles = require('../middlewares/requireRoles');
const { CONTENT_ROLES } = require('../utils/roles');

const router = Router();

// Public
router.get('/', [], GetAllActivities);
router.get('/tags', [], GetAllTags);

// Admin
router.get('/admin/all', JWTValidation, requireRoles(CONTENT_ROLES), GetAllActivitiesAdmin);
router.get('/admin/contributors', JWTValidation, requireRoles(CONTENT_ROLES), GetAllContributors);
router.get('/admin/id/:id', JWTValidation, requireRoles(CONTENT_ROLES), GetActivityById);
router.get('/admin/counts', JWTValidation, requireRoles(CONTENT_ROLES), GetActivityCounts);
router.post('/', JWTValidation, requireRoles(CONTENT_ROLES), CreateNewActivity);
router.put('/:id', JWTValidation, requireRoles(CONTENT_ROLES), UpdateActivityById);
router.delete('/:id', JWTValidation, requireRoles(CONTENT_ROLES), DeleteActivityById);

router.get('/:slug', [], GetActivityBySlug);

module.exports = router;
