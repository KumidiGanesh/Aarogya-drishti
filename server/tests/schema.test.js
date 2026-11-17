const { indexes, databaseName } = require('../src/db/mongo');

describe('MongoDB persistence schema', () => {
  it('uses the configured Aarogya database by default', () => {
    expect(databaseName).toBe(process.env.MONGODB_DATABASE || 'aarogya_drishti');
  });

  it('enforces unique user identifiers while allowing absent email and mobile fields', () => {
    expect(indexes.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { id: 1 }, options: { unique: true } }),
      expect.objectContaining({
        key: { email: 1 },
        options: {
          unique: true,
          partialFilterExpression: { email: { $type: 'string' } },
        },
      }),
      expect.objectContaining({
        key: { mobile: 1 },
        options: {
          unique: true,
          partialFilterExpression: { mobile: { $type: 'string' } },
        },
      }),
    ]));
  });

  it('indexes refresh token hashes, user sessions, and session families', () => {
    expect(indexes.refresh_tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { token_hash: 1 }, options: { unique: true } }),
      expect.objectContaining({ key: { family_id: 1 } }),
      expect.objectContaining({ key: { user_id: 1, revoked_at: 1 } }),
    ]));
  });

  it('enforces idempotent and unique patient records and indexes patient lookups', () => {
    expect(indexes.patients).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { patient_code: 1 }, options: { unique: true } }),
      expect.objectContaining({ key: { client_uuid: 1 }, options: { unique: true } }),
      expect.objectContaining({ key: { mobile: 1, deleted_at: 1, is_active: 1 } }),
      expect.objectContaining({ key: { registered_by: 1, created_at: -1 } }),
    ]));
  });

  it('indexes sensitive audit, notification, appointment, and screening access paths', () => {
    expect(indexes.audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { user_id: 1, created_at: -1 } }),
      expect.objectContaining({ key: { action: 1, created_at: -1 } }),
    ]));
    expect(indexes.notifications).toContainEqual({ key: { user_id: 1, is_read: 1, created_at: -1 } });
    expect(indexes.appointments).toEqual(expect.arrayContaining([
      { key: { patient_id: 1, scheduled_at: -1 } },
      { key: { doctor_id: 1, scheduled_at: 1 } },
    ]));
    expect(indexes.oral_screenings).toContainEqual({ key: { patient_id: 1, created_at: -1 } });
  });
});
