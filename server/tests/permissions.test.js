jest.mock('../src/db/mongo', () => ({ getDb: jest.fn() }));

const { ensurePermissionCatalog, DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');

describe('permission catalog bootstrap', () => {
  it('adds patient-owned screening access without replacing other role permissions', async () => {
    const roleCollection = {
      findOne: jest.fn(async ({ name }) =>
        name === 'patient'
          ? {
              name,
              permissions: ['patients:read', 'screenings:read'],
              permissions_version: 3,
              permission_catalog_version: 2,
            }
          : name === 'doctor'
            ? {
                name,
                permissions: ['patients:read'],
                permissions_version: 3,
                permission_catalog_version: 2,
              }
            : null,
      ),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const userCollection = {
      find: jest.fn(() => ({ toArray: async () => [{ id: 'patient-user' }] })),
      updateMany: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const refreshTokenCollection = {
      updateMany: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const permissionCollection = {
      updateOne: jest.fn(async () => ({ upsertedCount: 1 })),
    };
    const db = {
      collection: jest.fn(
        (name) =>
          ({
            roles: roleCollection,
            users: userCollection,
            refresh_tokens: refreshTokenCollection,
            permissions: permissionCollection,
          })[name],
      ),
    };

    await ensurePermissionCatalog(db);

    expect(roleCollection.updateOne).toHaveBeenCalledWith(
      { name: 'patient', permission_catalog_version: { $ne: 4 } },
      {
        $set: expect.objectContaining({
          permissions: ['patients:read', 'screenings:read', 'screenings:self:manage'],
          permissions_version: 4,
          permission_catalog_version: 4,
        }),
      },
    );
    expect(roleCollection.updateOne).toHaveBeenCalledWith(
      { name: 'doctor', permission_catalog_version: { $ne: 4 } },
      {
        $set: expect.objectContaining({
          permissions: ['patients:read', 'research:annotations:review'],
          permissions_version: 4,
          permission_catalog_version: 4,
        }),
      },
    );
    expect(userCollection.updateMany).toHaveBeenCalledWith(
      { id: { $in: ['patient-user'] } },
      { $set: expect.objectContaining({ permissions_version: 4 }) },
    );
    expect(refreshTokenCollection.updateMany).toHaveBeenCalledWith(
      { user_id: { $in: ['patient-user'] }, revoked_at: null },
      { $set: { revoked_at: expect.any(Date) } },
    );
    expect(permissionCollection.updateOne).toHaveBeenCalled();
    expect(DEFAULT_ROLE_PERMISSIONS.patient).toContain('screenings:self:manage');
    expect(DEFAULT_ROLE_PERMISSIONS.specialist).toContain('research:annotations:review');
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toContain('research:datasets:manage');
  });
});
