const { Router } = require('express');
const JWTValidation = require('../middlewares/auth');
const requireRoles = require('../middlewares/requireRoles');
const { BANTUAN_ROLES, FINANCE_ROLES, SUBMISSION_ROLES } = require('../utils/roles');
const {
  ListTallySubmissionsByForm,
  GetTallySubmissionById,
  UpdatePengajuanBantuanStatus,
  SendTallySubmissionWhatsapp,
} = require('../controllers/tallySubmissions');

const router = Router();

// Data donasi (nama, kontak, bukti transfer) hanya untuk bagian keuangan —
// SUBMISSION_ROLES memuat sekretariat dan tidak memuat bendahara.
const requireSubmissionRolesFor = {
  donasi: requireRoles(FINANCE_ROLES),
};
const requireDefaultSubmissionRoles = requireRoles(SUBMISSION_ROLES);
const requireRolesForFormSlug = (req, res, next) =>
  (requireSubmissionRolesFor[req.params.formSlug] || requireDefaultSubmissionRoles)(req, res, next);

router.get('/form/:formSlug', JWTValidation, requireRolesForFormSlug, ListTallySubmissionsByForm);
router.get('/form/:formSlug/:tallySubmissionId', JWTValidation, requireRolesForFormSlug, GetTallySubmissionById);
router.post('/form/:formSlug/:tallySubmissionId/whatsapp', JWTValidation, requireRolesForFormSlug, SendTallySubmissionWhatsapp);
router.patch('/pengajuan-bantuan/:tallySubmissionId/status', JWTValidation, requireRoles(BANTUAN_ROLES), UpdatePengajuanBantuanStatus);

module.exports = router;
