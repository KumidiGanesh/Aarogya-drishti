const { randomUUID } = require('node:crypto');
const PERMISSION_CATALOG_VERSION = 4;

const PERMISSIONS = Object.freeze([
  { code: 'users:read', description: 'View user accounts' },
  { code: 'users:manage', description: 'Create and manage user accounts' },
  { code: 'roles:manage', description: 'Manage role permissions' },
  { code: 'patients:read', description: 'View permitted patient records' },
  { code: 'patients:manage', description: 'Register and manage patient records' },
  { code: 'patients:self:manage', description: 'Manage own patient record' },
  { code: 'screenings:read', description: 'View permitted screening records' },
  { code: 'screenings:manage', description: 'Create and review screening records' },
  { code: 'research:datasets:manage', description: 'Manage consented research datasets' },
  { code: 'research:annotations:review', description: 'Review research dataset annotations' },
  { code: 'screenings:self:manage', description: 'Create and manage own screening records' },
  { code: 'appointments:read', description: 'View permitted appointments' },
  { code: 'appointments:manage', description: 'Book and manage permitted appointments' },
  { code: 'referrals:read', description: 'View permitted referrals' },
  { code: 'referrals:manage', description: 'Create and manage permitted referrals' },
  { code: 'consultations:read', description: 'View permitted consultations' },
  { code: 'consultations:manage', description: 'Manage permitted consultations' },
  { code: 'reports:read', description: 'View reports' },
  { code: 'reports.export', description: 'Export reports' },
  { code: 'export', description: 'Export administrative data' },
  { code: 'settings:read', description: 'View personal settings' },
  { code: 'settings:manage', description: 'Manage system settings' },
  { code: 'settings:self:manage', description: 'Manage personal settings' },
  { code: 'notifications:read', description: 'View own notifications' },
  { code: 'notifications:manage', description: 'Manage own notifications' },
  { code: 'languages:use', description: 'Manage language preferences' },
  { code: 'voice:use', description: 'Use voice assistance' },
  { code: 'medicines:read', description: 'View permitted medicine records' },
  { code: 'medicines:manage', description: 'Manage permitted medicines and reminders' },
  { code: 'emergency:use', description: 'Use emergency services' },
]);

const ALL_PERMISSIONS = Object.freeze(PERMISSIONS.map(({ code }) => code));
const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  super_admin: ALL_PERMISSIONS,
  admin: Object.freeze([
    'users:read',
    'users:manage',
    'patients:read',
    'patients:manage',
    'screenings:read',
    'screenings:manage',
    'appointments:read',
    'appointments:manage',
    'research:datasets:manage',
    'referrals:read',
    'referrals:manage',
    'consultations:read',
    'consultations:manage',
    'reports:read',
    'reports.export',
    'export',
    'settings:read',
    'settings:self:manage',
    'notifications:read',
    'notifications:manage',
    'languages:use',
    'voice:use',
    'medicines:read',
    'medicines:manage',
    'emergency:use',
  ]),
  doctor: Object.freeze([
    'patients:read',
    'patients:manage',
    'screenings:read',
    'screenings:manage',
    'research:annotations:review',
    'appointments:read',
    'appointments:manage',
    'referrals:read',
    'referrals:manage',
    'consultations:read',
    'consultations:manage',
    'reports:read',
    'settings:read',
    'settings:self:manage',
    'notifications:read',
    'notifications:manage',
    'languages:use',
    'voice:use',
    'medicines:read',
    'medicines:manage',
    'emergency:use',
  ]),
  health_worker: Object.freeze([
    'patients:read',
    'patients:manage',
    'screenings:read',
    'screenings:manage',
    'appointments:read',
    'appointments:manage',
    'referrals:read',
    'referrals:manage',
    'settings:read',
    'settings:self:manage',
    'notifications:read',
    'notifications:manage',
    'languages:use',
    'voice:use',
    'medicines:read',
    'medicines:manage',
    'emergency:use',
  ]),
  specialist: Object.freeze([
    'patients:read',
    'screenings:read',
    'screenings:manage',
    'appointments:read',
    'appointments:manage',
    'referrals:read',
    'referrals:manage',
    'consultations:read',
    'consultations:manage',
    'settings:read',
    'settings:self:manage',
    'notifications:read',
    'notifications:manage',
    'languages:use',
    'voice:use',
    'research:annotations:review',
    'medicines:read',
    'emergency:use',
  ]),
  patient: Object.freeze([
    'patients:read',
    'patients:self:manage',
    'screenings:read',
    'screenings:self:manage',
    'appointments:read',
    'appointments:manage',
    'referrals:read',
    'consultations:read',
    'consultations:manage',
    'settings:read',
    'settings:self:manage',
    'notifications:read',
    'notifications:manage',
    'languages:use',
    'voice:use',
    'medicines:read',
    'medicines:manage',
    'emergency:use',
  ]),
});

const ROLE_NAMES = Object.freeze(Object.keys(DEFAULT_ROLE_PERMISSIONS));
const PERMISSION_CODES = new Set(ALL_PERMISSIONS);

async function ensurePermissionCatalog(db) {
  const now = new Date();
  const roles = db.collection('roles');
  for (const role of ROLE_NAMES) {
    const current = await roles.findOne({ name: role });
    if (!current || current.permission_catalog_version === PERMISSION_CATALOG_VERSION) continue;
    const currentPermissions = Array.isArray(current.permissions)
      ? current.permissions
      : DEFAULT_ROLE_PERMISSIONS[role];
    const additions =
      role === 'patient'
        ? ['screenings:self:manage']
        : role === 'admin'
          ? ['research:datasets:manage']
          : ['doctor', 'specialist'].includes(role)
            ? ['research:annotations:review']
            : [];
    const nextPermissions = [...new Set([...currentPermissions, ...additions])];
    const permissionsChanged =
      nextPermissions.length !== currentPermissions.length ||
      nextPermissions.some((permission) => !currentPermissions.includes(permission));
    const nextVersion = Number(current.permissions_version || 1) + (permissionsChanged ? 1 : 0);
    const updated = await roles.updateOne(
      { name: role, permission_catalog_version: { $ne: PERMISSION_CATALOG_VERSION } },
      {
        $set: {
          permissions: nextPermissions,
          permissions_version: nextVersion,
          permission_catalog_version: PERMISSION_CATALOG_VERSION,
          updated_at: now,
        },
      },
    );
    if (updated.modifiedCount !== 1 || !permissionsChanged) continue;
    const users = await db
      .collection('users')
      .find({ role }, { projection: { id: 1 } })
      .toArray();
    const userIds = users.map((user) => user.id);
    if (!userIds.length) continue;
    await Promise.all([
      db
        .collection('users')
        .updateMany(
          { id: { $in: userIds } },
          { $set: { permissions_version: nextVersion, updated_at: now } },
        ),
      db
        .collection('refresh_tokens')
        .updateMany({ user_id: { $in: userIds }, revoked_at: null }, { $set: { revoked_at: now } }),
    ]);
  }
  for (const permission of PERMISSIONS) {
    await db.collection('permissions').updateOne(
      { code: permission.code },
      {
        $set: { ...permission, updated_at: now },
        $setOnInsert: { id: randomUUID(), created_at: now },
      },
      { upsert: true },
    );
  }
}

module.exports = {
  PERMISSIONS,
  PERMISSION_CATALOG_VERSION,
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_NAMES,
  PERMISSION_CODES,
  ensurePermissionCatalog,
};
