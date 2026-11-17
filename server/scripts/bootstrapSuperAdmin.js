require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const bcrypt = require('bcrypt');
const { randomUUID } = require('node:crypto');
const { checkConnection, closeMongo, getDb } = require('../src/db/mongo');
const { DEFAULT_ROLE_PERMISSIONS, ensurePermissionCatalog } = require('../src/auth/permissions');

async function bootstrap() {
  const { SUPER_ADMIN_SETUP_NAME, SUPER_ADMIN_SETUP_EMAIL, SUPER_ADMIN_SETUP_MOBILE, SUPER_ADMIN_SETUP_PASSWORD } = process.env;
  if (!SUPER_ADMIN_SETUP_NAME || !SUPER_ADMIN_SETUP_EMAIL || !SUPER_ADMIN_SETUP_MOBILE || !SUPER_ADMIN_SETUP_PASSWORD) {
    throw new Error('Set SUPER_ADMIN_SETUP_NAME, SUPER_ADMIN_SETUP_EMAIL, SUPER_ADMIN_SETUP_MOBILE, and SUPER_ADMIN_SETUP_PASSWORD for one-time setup');
  }
  if (!/^[6-9]\d{9}$/.test(SUPER_ADMIN_SETUP_MOBILE)) {
    throw new Error('SUPER_ADMIN_SETUP_MOBILE must be a valid 10-digit Indian mobile number');
  }
  if (
    SUPER_ADMIN_SETUP_PASSWORD.length < 8
    || !/[a-z]/.test(SUPER_ADMIN_SETUP_PASSWORD)
    || !/[A-Z]/.test(SUPER_ADMIN_SETUP_PASSWORD)
    || !/\d/.test(SUPER_ADMIN_SETUP_PASSWORD)
  ) {
    throw new Error('SUPER_ADMIN_SETUP_PASSWORD must be at least 8 characters and contain uppercase, lowercase, and numeric characters');
  }

  await checkConnection();
  const db = await getDb();
  const users = db.collection('users');
  const existingSuperAdmin = await users.findOne({ role: 'super_admin' });
  if (existingSuperAdmin) throw new Error('A Super Admin already exists; one-time setup is no longer available');
  const email = SUPER_ADMIN_SETUP_EMAIL.trim().toLowerCase();
  const duplicate = await users.findOne({
    $or: [{ email }, { mobile: SUPER_ADMIN_SETUP_MOBILE }],
    deleted_at: null,
  });
  if (duplicate) throw new Error('The setup email or mobile number already belongs to an account');

  const roles = db.collection('roles');
  let role = await roles.findOne({ name: 'super_admin' });
  if (!role) {
    role = {
      id: randomUUID(),
      name: 'super_admin',
      description: 'Super administrator',
      is_system: true,
      permissions: DEFAULT_ROLE_PERMISSIONS.super_admin,
      permissions_version: 1,
      permission_catalog_version: 2,
      created_at: new Date(),
    };
    await roles.insertOne(role);
  }
  await ensurePermissionCatalog(db);

  const now = new Date();
  const user = {
    id: randomUUID(),
    full_name: SUPER_ADMIN_SETUP_NAME.trim(),
    email,
    mobile: SUPER_ADMIN_SETUP_MOBILE,
    password_hash: await bcrypt.hash(SUPER_ADMIN_SETUP_PASSWORD, 12),
    role: 'super_admin',
    is_active: true,
    admin_registration_status: 'approved',
    approved_at: now,
    permissions_version: role.permissions_version || 1,
    failed_login_count: 0,
    locked_until: null,
    must_change_password: false,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  await users.insertOne(user);
  await db.collection('audit_logs').insertOne({
    id: randomUUID(),
    user_id: user.id,
    action: 'system.super_admin.bootstrap',
    entity: 'users',
    entity_id: user.id,
    metadata: { one_time_setup: true },
    created_at: now,
  });
  console.log('Initial Super Admin created. Remove the SUPER_ADMIN_SETUP_* environment variables now.');
}

bootstrap()
  .catch((error) => {
    console.error(`Super Admin setup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeMongo);
