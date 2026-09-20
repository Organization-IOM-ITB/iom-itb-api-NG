const { StatusCodes } = require('http-status-codes');
const BaseError = require('../../schemas/responses/BaseError');

// TODO: cuma bankes yg pake fitur registrasi, takut rolenya kelebihan, security concerns
const VALID_ROLES = [
  'pengurus-bidang-1',
  'pengurus-bidang-2',
  'mahasiswa',
  'orang-tua-asuh',
  'volunteer-pewawancara',
  'sekretariat',
  'bendahara',
];

function parseKeycloakUrl(issuerUrl) {
  const match = issuerUrl.match(/^(https?:\/\/.+?)\/realms\/(.+)$/);
  if (!match) {
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: 'Invalid KEYCLOAK_ISSUER_URL format — expected https://host/realms/realmName',
    });
  }
  return { baseUrl: match[1], realm: match[2] };
}

async function getAdminToken(baseUrl, realm) {
  const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: 'Keycloak admin client credentials are not configured',
    });
  }

  const res = await fetch(
    `${baseUrl}/realms/${realm}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to get Keycloak admin token: ${text}`,
    });
  }

  const data = await res.json();
  return data.access_token;
}

async function createKeycloakUser(baseUrl, realm, adminToken, { email, password, username, firstName, lastName, enabled = true }) {
  const payload = {
    username: username || email,
    email,
    enabled,
    emailVerified: true,
    credentials: [{ type: 'password', value: password, temporary: false }],
  };

  if (firstName) payload.firstName = firstName;
  if (lastName) payload.lastName = lastName;

  const res = await fetch(`${baseUrl}/admin/realms/${realm}/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (res.status === 409) {
    throw new BaseError({
      status: StatusCodes.CONFLICT,
      message: 'A user with this email already exists',
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to create user in Keycloak: ${text}`,
    });
  }

  // Keycloak returns the new user's URL in the Location header
  const location = res.headers.get('location');
  if (!location) {
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: 'Keycloak did not return a user location after creation',
    });
  }

  return location.split('/').pop();
}

async function getRealmRole(baseUrl, realm, adminToken, roleName) {
  const res = await fetch(
    `${baseUrl}/admin/realms/${realm}/roles/${encodeURIComponent(roleName)}`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    }
  );

  if (res.status === 404) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: `Role "${roleName}" does not exist in Keycloak realm`,
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to fetch role from Keycloak: ${text}`,
    });
  }

  return res.json();
}

async function assignRealmRole(baseUrl, realm, adminToken, userId, role) {
  const res = await fetch(
    `${baseUrl}/admin/realms/${realm}/users/${userId}/role-mappings/realm`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ id: role.id, name: role.name }]),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to assign role in Keycloak: ${text}`,
    });
  }
}

const registerKeycloakUser = async ({ email, password, role, username, firstName, lastName, enabled = true }) => {
  if (!email || !password || !role) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: 'email, password, and role are required',
    });
  }

  if (!VALID_ROLES.includes(role)) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`,
    });
  }

  const issuerUrl = process.env.KEYCLOAK_ISSUER_URL;
  if (!issuerUrl) {
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: 'KEYCLOAK_ISSUER_URL is not configured',
    });
  }

  const { baseUrl, realm } = parseKeycloakUrl(issuerUrl);
  const adminToken = await getAdminToken(baseUrl, realm);
  const userId = await createKeycloakUser(baseUrl, realm, adminToken, { email, password, username, firstName, lastName, enabled });
  const roleObj = await getRealmRole(baseUrl, realm, adminToken, role);
  await assignRealmRole(baseUrl, realm, adminToken, userId, roleObj);

  return { userId, email, role, enabled };
};

async function getAssignedRealmRoles(baseUrl, realm, adminToken, userId) {
  const res = await fetch(
    `${baseUrl}/admin/realms/${realm}/users/${userId}/role-mappings/realm`,
    { headers: { Authorization: `Bearer ${adminToken}` } }
  );

  if (res.status === 404) {
    throw new BaseError({
      status: StatusCodes.NOT_FOUND,
      message: 'User not found in Keycloak',
    });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to read role mappings from Keycloak: ${text}`,
    });
  }

  return res.json();
}

// Hanya role yang dikenal aplikasi yang dicabut. Role bawaan realm seperti
// "default-roles-<realm>" atau "offline_access" harus dibiarkan, karena
// mencabutnya bisa merusak akun.
async function removeManagedRealmRoles(baseUrl, realm, adminToken, userId) {
  const assigned = await getAssignedRealmRoles(baseUrl, realm, adminToken, userId);
  const managed = assigned.filter((r) => VALID_ROLES.includes(r.name));

  if (managed.length === 0) return;

  const res = await fetch(
    `${baseUrl}/admin/realms/${realm}/users/${userId}/role-mappings/realm`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(managed.map((r) => ({ id: r.id, name: r.name }))),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: `Failed to remove existing roles in Keycloak: ${text}`,
    });
  }
}

const withAdmin = async (fn) => {
  const issuerUrl = process.env.KEYCLOAK_ISSUER_URL;
  if (!issuerUrl) {
    throw new BaseError({
      status: StatusCodes.INTERNAL_SERVER_ERROR,
      message: 'KEYCLOAK_ISSUER_URL is not configured',
    });
  }

  const { baseUrl, realm } = parseKeycloakUrl(issuerUrl);
  const adminToken = await getAdminToken(baseUrl, realm);
  return fn(baseUrl, realm, adminToken);
};

const updateKeycloakUserRole = async ({ userId, role }) => {
  if (!userId || !role) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: 'userId and role are required',
    });
  }

  if (!VALID_ROLES.includes(role)) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`,
    });
  }

  return withAdmin(async (baseUrl, realm, adminToken) => {
    const roleObj = await getRealmRole(baseUrl, realm, adminToken, role);
    await removeManagedRealmRoles(baseUrl, realm, adminToken, userId);
    await assignRealmRole(baseUrl, realm, adminToken, userId, roleObj);
    return { userId, role };
  });
};

const setKeycloakUserEnabled = async ({ userId, enabled }) => {
  if (!userId || typeof enabled !== 'boolean') {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: 'userId and boolean enabled are required',
    });
  }

  return withAdmin(async (baseUrl, realm, adminToken) => {
    const res = await fetch(`${baseUrl}/admin/realms/${realm}/users/${userId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    });

    if (res.status === 404) {
      throw new BaseError({
        status: StatusCodes.NOT_FOUND,
        message: 'User not found in Keycloak',
      });
    }

    if (!res.ok) {
      const text = await res.text();
      throw new BaseError({
        status: StatusCodes.INTERNAL_SERVER_ERROR,
        message: `Failed to update user in Keycloak: ${text}`,
      });
    }

    return { userId, enabled };
  });
};

const deleteKeycloakUser = async ({ userId }) => {
  if (!userId) {
    throw new BaseError({
      status: StatusCodes.BAD_REQUEST,
      message: 'userId is required',
    });
  }

  return withAdmin(async (baseUrl, realm, adminToken) => {
    const res = await fetch(`${baseUrl}/admin/realms/${realm}/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    // 404 diperlakukan sebagai sukses supaya operasi ini idempoten — tujuannya
    // memastikan akun tidak ada lagi, dan itu sudah terpenuhi.
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new BaseError({
        status: StatusCodes.INTERNAL_SERVER_ERROR,
        message: `Failed to delete user in Keycloak: ${text}`,
      });
    }

    return { userId, deleted: true };
  });
};

module.exports = registerKeycloakUser;
module.exports.updateKeycloakUserRole = updateKeycloakUserRole;
module.exports.setKeycloakUserEnabled = setKeycloakUserEnabled;
module.exports.deleteKeycloakUser = deleteKeycloakUser;
