const collections = new Map();

function matches(document, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === '$ne') return actual !== value;
        return actual === value;
      });
    }
    return actual === expected || (expected === null && actual === undefined);
  });
}

function collection(name) {
  if (!collections.has(name)) collections.set(name, []);
  const rows = collections.get(name);
  return {
    async findOne(filter) {
      return rows.find((row) => matches(row, filter)) || null;
    },
    find(filter) {
      let result = rows.filter((row) => matches(row, filter));
      const cursor = {
        sort(spec) {
          result.sort((left, right) => {
            for (const [field, direction] of Object.entries(spec)) {
              const a = left[field] instanceof Date ? left[field].getTime() : left[field];
              const b = right[field] instanceof Date ? right[field].getTime() : right[field];
              if (a < b) return -direction;
              if (a > b) return direction;
            }
            return 0;
          });
          return cursor;
        },
        limit(count) {
          result = result.slice(0, count);
          return cursor;
        },
        async toArray() {
          return result;
        },
      };
      return cursor;
    },
    async insertOne(document) {
      rows.push(document);
      return { insertedId: document.id };
    },
    async updateOne(filter, update) {
      const row = rows.find((candidate) => matches(candidate, filter));
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    },
    async updateMany(filter, update) {
      const matched = rows.filter((row) => matches(row, filter));
      for (const row of matched) Object.assign(row, update.$set);
      return { modifiedCount: matched.length };
    },
  };
}

const mockDb = { collection: jest.fn(collection) };
jest.mock('../src/db/mongo', () => ({
  getDb: jest.fn(async () => mockDb),
}));

const research = require('../src/research/service');

const user = { sub: 'synthetic-patient-user', role: 'patient' };
const patient = {
  id: 'synthetic-patient',
  user_id: user.sub,
  is_active: true,
  deleted_at: null,
};

function seed(name, ...documents) {
  collections.set(name, documents);
}

function configureGovernance(enabled = true) {
  process.env.RESEARCH_GOVERNANCE_ENABLED = String(enabled);
  process.env.RESEARCH_ETHICS_APPROVAL_REFERENCE = 'test-only-reference';
  process.env.RESEARCH_GOVERNANCE_BODY = 'test-only-governance-body';
  process.env.RESEARCH_GOVERNANCE_CONTACT = 'test@example.invalid';
  process.env.RESEARCH_RETENTION_POLICY = 'test-only-policy';
  process.env.RESEARCH_CONSENT_VERSION = 'test-v1';
  process.env.RESEARCH_SUBJECT_HMAC_KEY = 'test-only-hmac-key-0123456789012345';
}

beforeEach(() => {
  collections.clear();
  jest.clearAllMocks();
  configureGovernance();
  seed('patients', patient);
});

describe('research consent governance', () => {
  it('keeps research AI training consent independent from Gemini AI-processing consent', async () => {
    const geminiConsent = {
      id: 'gemini-consent',
      patient_id: patient.id,
      consent_type: 'ai_processing',
      granted: false,
      version: 2,
    };
    seed('patient_consents', geminiConsent);

    const before = await research.getResearchConsent(user);
    expect(before.consent).toBeNull();
    const researchGrant = await research.grantResearchConsent(
      { research_ai_training: true, language: 'en' },
      user,
    );

    expect(researchGrant.status).toBe('granted');
    expect(collections.get('research_consents')).toHaveLength(1);
    expect(collections.get('patient_consents')).toEqual([geminiConsent]);
  });

  it('does not expose participant consent status to non-patient roles', async () => {
    await expect(
      research.getResearchConsent({ sub: 'synthetic-doctor-user', role: 'doctor' }),
    ).rejects.toMatchObject({ status: 403, code: 'PATIENT_ACCOUNT_REQUIRED' });
    expect(collections.get('research_consents') || []).toEqual([]);
  });

  it('fails closed until governance configuration is enabled', async () => {
    configureGovernance(false);
    await expect(
      research.grantResearchConsent({ research_ai_training: true, language: 'en' }, user),
    ).rejects.toMatchObject({ status: 503, code: 'RESEARCH_GOVERNANCE_UNAVAILABLE' });
    const status = await research.getResearchConsent(user);
    expect(status.governance.enabled).toBe(false);
    expect(collections.get('research_consents')).toEqual([]);
  });

  it('records an explicit versioned grant and rejects duplicate active grants', async () => {
    const grant = await research.grantResearchConsent(
      { research_ai_training: true, language: 'en' },
      user,
    );
    expect(grant).toMatchObject({
      patient_id: patient.id,
      user_id: user.sub,
      purpose: 'research_ai_training',
      status: 'granted',
      consent_version: 'test-v1',
      language: 'en',
    });
    expect(grant.granted_at).toBeInstanceOf(Date);
    expect(collections.get('audit_logs')).toEqual([
      expect.objectContaining({ action: 'research.consent_granted', entity: 'research_consent' }),
    ]);
    await expect(
      research.grantResearchConsent({ research_ai_training: true, language: 'en' }, user),
    ).rejects.toMatchObject({ status: 409, code: 'RESEARCH_CONSENT_ALREADY_ACTIVE' });
  });

  it('withdraws consent, preserves clinical records, audits, and blocks enrolled research items', async () => {
    const grant = await research.grantResearchConsent(
      { research_ai_training: true, language: 'en' },
      user,
    );
    seed(
      'research_dataset_items',
      { id: 'item-1', consent_record_id: grant.id, research_use_blocked: false },
    );
    seed('clinical_records', { id: 'clinical-1', patient_id: patient.id });

    const withdrawal = await research.withdrawResearchConsent(user);
    expect(withdrawal).toMatchObject({
      patient_id: patient.id,
      status: 'withdrawn',
      previous_record_id: grant.id,
    });
    expect(withdrawal.withdrawn_at).toBeInstanceOf(Date);
    expect(collections.get('research_dataset_items')[0].research_use_blocked).toBe(true);
    expect(collections.get('clinical_records')).toEqual([
      { id: 'clinical-1', patient_id: patient.id },
    ]);
    expect(collections.get('audit_logs')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'research.consent_withdrawal_items_blocked',
          entity: 'research_consent',
          metadata: expect.objectContaining({ blocked_dataset_items: 1 }),
        }),
      ]),
    );
    await expect(research.withdrawResearchConsent(user)).rejects.toMatchObject({
      status: 409,
      code: 'NO_ACTIVE_RESEARCH_CONSENT',
    });
    const renewed = await research.grantResearchConsent(
      { research_ai_training: true, language: 'en' },
      user,
    );
    const status = await research.getResearchConsent(user);
    expect(renewed.sequence).toBe(3);
    expect(status.consent.id).toBe(renewed.id);
    expect(status.history.map((entry) => entry.sequence)).toEqual([3, 2, 1]);
    expect(collections.get('research_dataset_items')[0].research_use_blocked).toBe(true);
  });

  it('rejects enrollment using a legacy, invalid, or withdrawn consent', async () => {
    seed('research_datasets', { id: 'dataset-1', status: 'open', version: 'v1' });
    seed('oral_images', { id: 'image-1', screening_id: 'screening-1' });
    seed('oral_screenings', { id: 'screening-1', patient_id: patient.id });
    seed('patient_consents', {
      id: 'legacy-consent',
      patient_id: patient.id,
      consent_type: 'research_ai_training',
      granted: true,
    });
    await expect(
      research.addImage(
        'dataset-1',
        { image_id: 'image-1', consent_record_id: 'legacy-consent', split: 'train' },
        { sub: 'staff-user' },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'RESEARCH_CONSENT_REQUIRED' });
  });

  it('rejects future dataset enrollment after research consent is withdrawn', async () => {
    seed('research_datasets', { id: 'dataset-1', status: 'open', version: 'v1' });
    seed('oral_images', { id: 'image-1', screening_id: 'screening-1' });
    seed('oral_screenings', { id: 'screening-1', patient_id: patient.id });
    const grant = await research.grantResearchConsent(
      { research_ai_training: true, language: 'en' },
      user,
    );
    await research.withdrawResearchConsent(user);

    await expect(
      research.addImage(
        'dataset-1',
        { image_id: 'image-1', consent_record_id: grant.id, split: 'train' },
        { sub: 'staff-user' },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'RESEARCH_CONSENT_REQUIRED' });
    expect(collections.get('research_dataset_items') || []).toEqual([]);
  });

  it('enrolls an image only with the participant current active research consent', async () => {
    seed('research_datasets', { id: 'dataset-1', status: 'open', version: 'v1' });
    seed('oral_images', { id: 'image-1', screening_id: 'screening-1' });
    seed('oral_screenings', { id: 'screening-1', patient_id: patient.id });
    const grant = await research.grantResearchConsent(
      { research_ai_training: true, language: 'en' },
      user,
    );

    const item = await research.addImage(
      'dataset-1',
      { image_id: 'image-1', consent_record_id: grant.id, split: 'train' },
      { sub: 'staff-user' },
    );
    expect(item).toMatchObject({
      patient_id: patient.id,
      consent_record_id: grant.id,
      consent_version: 'test-v1',
      split: 'train',
      research_use_blocked: false,
    });
    expect(item.subject_key).toMatch(/^[a-f0-9]{64}$/);

    await research.withdrawResearchConsent(user);
    await expect(
      research.addImage(
        'dataset-1',
        { image_id: 'image-1', consent_record_id: grant.id, split: 'train' },
        { sub: 'staff-user' },
      ),
    ).rejects.toMatchObject({ status: 403, code: 'RESEARCH_CONSENT_REQUIRED' });
  });

  it('does not expose withdrawn dataset items', async () => {
    const grant = await research.grantResearchConsent(
      { research_ai_training: true, language: 'en' },
      user,
    );
    seed('research_datasets', { id: 'dataset-1', status: 'open' });
    seed('research_dataset_items', {
      id: 'item-1',
      dataset_id: 'dataset-1',
      patient_id: patient.id,
      consent_record_id: grant.id,
      image_id: 'image-1',
      research_use_blocked: false,
      created_at: new Date(),
    });
    await research.withdrawResearchConsent(user);

    const result = await research.listItems('dataset-1');
    expect(result.items).toEqual([]);
    expect(result.manifest.item_count).toBe(0);
  });
});
