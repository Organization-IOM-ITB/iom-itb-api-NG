const { StatusCodes } = require('http-status-codes');
const BaseResponse = require('../schemas/responses/BaseResponse');
const {
  buildAccessibleApps,
  getAppUrl,
  getWebRedirectUrl,
  getUserRolesFromToken,
  isAnyRoleAllowed,
  isRoleAllowedForApp,
} = require('../utils/ssoAccess');
const registerKeycloakUser = require('../services/auth/registerKeycloak');
const {
  updateKeycloakUserRole,
  setKeycloakUserEnabled,
  deleteKeycloakUser,
} = require('../services/auth/registerKeycloak');

const normalizeUser = (user = {}) => ({
  sub: user.sub,
  email: user.email,
  name: user.name,
  preferredUsername: user.preferred_username,
});

const getMe = async (req, res) => {
  try {
    const roles = getUserRolesFromToken(req.user);
    const apps = buildAccessibleApps(roles);

    res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: 'SSO session active',
        data: {
          user: normalizeUser(req.user),
          roles,
          apps,
          hasWebAccess: isAnyRoleAllowed(roles, 'web'),
        },
      })
    );
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(
      new BaseResponse({
        status,
        message: error.message || 'Failed to load SSO profile',
      })
    );
  }
};

const getApps = async (req, res) => {
  try {
    const roles = getUserRolesFromToken(req.user);
    const apps = buildAccessibleApps(roles);

    res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: 'Accessible apps loaded',
        data: {
          apps,
          roles,
        },
      })
    );
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(
      new BaseResponse({
        status,
        message: error.message || 'Failed to load accessible apps',
      })
    );
  }
};

const selectApp = async (req, res) => {
  try {
    const roles = getUserRolesFromToken(req.user);
    const { appId, role } = req.body || {};

    if (!appId || typeof appId !== 'string') {
      return res.status(StatusCodes.BAD_REQUEST).json(
        new BaseResponse({
          status: StatusCodes.BAD_REQUEST,
          message: 'appId is required',
        })
      );
    }

    if (!role || typeof role !== 'string') {
      return res.status(StatusCodes.BAD_REQUEST).json(
        new BaseResponse({
          status: StatusCodes.BAD_REQUEST,
          message: 'role is required',
        })
      );
    }

    if (!roles.includes(role)) {
      return res.status(StatusCodes.FORBIDDEN).json(
        new BaseResponse({
          status: StatusCodes.FORBIDDEN,
          message: 'Role not assigned to current user',
        })
      );
    }

    if (!isRoleAllowedForApp(role, appId)) {
      return res.status(StatusCodes.FORBIDDEN).json(
        new BaseResponse({
          status: StatusCodes.FORBIDDEN,
          message: 'Selected role has no access to selected app',
        })
      );
    }

    const redirectUrl = appId === 'web' ? getWebRedirectUrl(role) : getAppUrl(appId);

    if (!redirectUrl || redirectUrl === '#') {
      return res.status(StatusCodes.SERVICE_UNAVAILABLE).json(
        new BaseResponse({
          status: StatusCodes.SERVICE_UNAVAILABLE,
          message: `Aplikasi "${appId}" belum dikonfigurasi di server. Hubungi administrator.`,
        })
      );
    }

    res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: 'App selection accepted',
        data: {
          selectedAppId: appId,
          selectedRole: role,
          redirectUrl,
        },
      })
    );
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(
      new BaseResponse({
        status,
        message: error.message || 'Failed to process app selection',
      })
    );
  }
};

const registerUser = async (req, res) => {
  try {
    const { email, password, role, username, firstName, lastName, enabled } = req.body;
    const result = await registerKeycloakUser({
      email,
      password,
      role,
      username,
      firstName,
      lastName,
      // Default tetap true supaya pemanggil lama (OTA-KU) tidak berubah perilakunya.
      enabled: enabled === undefined ? true : enabled === true || enabled === 'true',
    });

    res.status(StatusCodes.CREATED).json(
      new BaseResponse({
        status: StatusCodes.CREATED,
        message: 'User registered successfully',
        data: result,
      })
    );
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(
      new BaseResponse({
        status,
        message: error.message || 'Registration failed',
      })
    );
  }
};

const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const result = await updateKeycloakUserRole({ userId: id, role });

    res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: 'User role updated successfully',
        data: result,
      })
    );
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(
      new BaseResponse({ status, message: error.message || 'Failed to update role' })
    );
  }
};

const updateUserEnabled = async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;
    const result = await setKeycloakUserEnabled({
      userId: id,
      enabled: enabled === true || enabled === 'true',
    });

    res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: result.enabled ? 'User enabled' : 'User disabled',
        data: result,
      })
    );
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(
      new BaseResponse({ status, message: error.message || 'Failed to update user' })
    );
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await deleteKeycloakUser({ userId: id });

    res.status(StatusCodes.OK).json(
      new BaseResponse({
        status: StatusCodes.OK,
        message: 'User deleted successfully',
        data: result,
      })
    );
  } catch (error) {
    const status = error.status || StatusCodes.INTERNAL_SERVER_ERROR;
    res.status(status).json(
      new BaseResponse({ status, message: error.message || 'Failed to delete user' })
    );
  }
};

module.exports = {
  getMe,
  getApps,
  selectApp,
  registerUser,
  updateUserRole,
  updateUserEnabled,
  deleteUser,
};
