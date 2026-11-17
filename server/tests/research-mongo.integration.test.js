'use strict';

const { randomUUID } = require('node:crypto');
const integrationEnabled = process.env.RESEARCH_MONGODB_INTEGRATION === 'true';
const testDatabase = process.env.MONGODB_DATABASE || '';
const mongoUri = process.env.MONGODB_URI || '';

if (integrationEnabled) {
  const parsedUri = new URL(mongoUri);
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(parsedUri.hostname) ||
    !/^aarogya_drishti_research_test_[a-z0-9_]+$/.test(testDatabase) ||
    parsedUri.pathname.length > 1
  ) {
    throw new Error(
      'Research MongoDB integration tests require a loopback MongoDB URI and a dedicated research-test database name',
    );
  }
}

process.env.JWT_ACCESS_SECRET = 'research-integration-access-secret-only';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');
const { indexes } = require('../src/db/mongo');
const { validate: validateManifest } = require('../../research/oral-cv/validate-manifest');
const app = require('../src/app');

jest.setTimeout(60_000);

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration('MongoDB-backed research curation workflow', () => {
  let db;
  let closeMongo;
  let users;
  let patients;
  let consents;
  let dataset;
  let imageIds;

  const priorResearchEnvironment = {};
  const researchEnvironment = {
    RESEARCH_GOVERNANCE_ENABLED: 'true',
    RESEARCH_ETHICS_APPROVAL_REFERENCE: 'TEST FIXTURE ONLY - NOT AN APPROVAL',
    RESEARCH_GOVERNANCE_BODY: 'TEST FIXTURE ONLY - NOT A GOVERNANCE BODY',
    RESEARCH_GOVERNANCE_CONTACT: 'test-only@example.invalid',
    RESEARCH_RETENTION_POLICY: 'TEST FIXTURE ONLY - NOT AN APPROVED POLICY',
    RESEARCH_CONSENT_VERSION: 'integration-v1',
    RESEARCH_SUBJECT_HMAC_KEY: 'test-only-hmac-key-0123456789abcdef',
  };

  async function createImage(patientId) {
    const imageId = randomUUID();
    const screeningId = randomUUID();
    await db.collection('oral_screenings').insertOne({
      id: screeningId,
      patient_id: patientId,
      created_at: new Date(),
    });
    await db.collection('oral_images').insertOne({
      id: imageId,
      screening_id: screeningId,
      encrypted_object_id: `opaque-object-${imageId}`,
      created_at: new Date(),
    });
    return imageId;
  }

  function auth(role) {
    return { Authorization: `Bearer ${users[role].token}` };
  }

  async function grantConsent(patientIndex) {
    const response = await request(app)
      .post('/api/research/consent')
      .set(auth(`patient${patientIndex}`))
      .send({ research_ai_training: true, language: 'en' });
    expect(response.status).toBe(201);
    consents[patientIndex] = response.body.data;
    return response.body.data;
  }

  async function enroll(imageId, consent, split) {
    return request(app)
      .post(`/api/research/datasets/${dataset.id}/items`)
      .set(auth('admin'))
      .send({ image_id: imageId, consent_record_id: consent.id, split });
  }

  beforeAll(async () => {
    if (!integrationEnabled) return;
    for (const [name, value] of Object.entries(researchEnvironment)) {
      priorResearchEnvironment[name] = process.env[name];
      process.env[name] = value;
    }

    const mongo = require('../src/db/mongo');
    closeMongo = mongo.closeMongo;
    db = await mongo.getDb();
    if (db.databaseName !== testDatabase)
      throw new Error('Research integration test database does not match MongoDB configuration');

    users = {};
    const roleNames = [
      'admin',
      'doctor',
      'specialist',
      'health_worker',
      'patient1',
      'patient2',
      'patient3',
      'patient4',
    ];
    for (const role of roleNames) {
      const baseRole = role.startsWith('patient') ? 'patient' : role;
      const userId = randomUUID();
      const sessionId = randomUUID();
      await db.collection('roles').updateOne(
        { name: baseRole },
        {
          $set: { is_system: true, permissions_version: 1 },
          $setOnInsert: { name: baseRole },
        },
        { upsert: true },
      );
      await db.collection('users').insertOne({
        id: userId,
        role: baseRole,
        is_active: true,
        deleted_at: null,
        permissions_version: 1,
        full_name: `Synthetic ${role}`,
        email: `${role}@example.invalid`,
        mobile: `900000${String(Object.keys(users).length).padStart(4, '0')}`,
      });
      await db.collection('refresh_tokens').insertOne({
        id: sessionId,
        user_id: userId,
        revoked_at: null,
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      });
      users[role] = {
        id: userId,
        role: baseRole,
        permissions: DEFAULT_ROLE_PERMISSIONS[baseRole],
        token: jwt.sign(
          {
            role: baseRole,
            permissions: DEFAULT_ROLE_PERMISSIONS[baseRole],
            pv: 1,
            sid: sessionId,
          },
          process.env.JWT_ACCESS_SECRET,
          { subject: userId, expiresIn: '30m' },
        ),
      };
      if (baseRole === 'patient') {
        const patientId = randomUUID();
        await db.collection('patients').insertOne({
          id: patientId,
          user_id: userId,
          is_active: true,
          deleted_at: null,
          full_name: `Synthetic Research Participant ${role.slice(-1)}`,
          mobile: `800000${String(Object.keys(patients || {}).length).padStart(4, '0')}`,
          email: `${role}-patient@example.invalid`,
        });
        patients ||= {};
        patients[role] = patientId;
      }
    }

    imageIds = {};
    for (let index = 1; index <= 4; index += 1) {
      imageIds[`patient${index}`] = [await createImage(patients[`patient${index}`])];
    }
    imageIds.patient1.push(await createImage(patients.patient1));
  }, 30_000);

  afterAll(async () => {
    if (!integrationEnabled) return;
    try {
      if (
        ['127.0.0.1', 'localhost', '::1'].includes(new URL(mongoUri).hostname) &&
        /^aarogya_drishti_research_test_[a-z0-9_]+$/.test(testDatabase) &&
        db?.databaseName === testDatabase
      ) {
        await db.dropDatabase();
      }
    } finally {
      if (closeMongo) await closeMongo();
      for (const name of Object.keys(researchEnvironment)) {
        if (priorResearchEnvironment[name] === undefined) delete process.env[name];
        else process.env[name] = priorResearchEnvironment[name];
      }
    }
  });

  it('creates required MongoDB indexes in the migrated isolated database', async () => {
    for (const name of ['research_consents', 'research_datasets', 'research_dataset_items', 'research_annotations']) {
      const actual = await db.collection(name).indexes();
      for (const expected of indexes[name]) {
        const index = actual.find((candidate) =>
          JSON.stringify(candidate.key) === JSON.stringify(expected.key),
        );
        expect(index).toBeDefined();
        if (expected.options.unique) expect(index.unique).toBe(true);
      }
    }
    const sequenceIndex = (await db.collection('research_consents').indexes()).find(
      (index) => JSON.stringify(index.key) === JSON.stringify({ patient_id: 1, sequence: 1 }),
    );
    expect(sequenceIndex.unique).toBe(true);
    expect(sequenceIndex.partialFilterExpression).toEqual({ sequence: { $exists: true } });
  });

  it('protects every research API by authentication, role, permission, and patient ownership', async () => {
    const id = randomUUID();
    const protectedRequests = [
      request(app).get('/api/research/consent'),
      request(app).post('/api/research/consent').send({ research_ai_training: true, language: 'en' }),
      request(app).post('/api/research/consent/withdraw').send({}),
      request(app).get('/api/research/datasets'),
      request(app).get(`/api/research/datasets/${id}/items`),
      request(app).post('/api/research/datasets').send({ name: 'Test dataset', version: 'v1' }),
      request(app).post(`/api/research/datasets/${id}/items`).send({
        image_id: id,
        consent_record_id: id,
        split: 'train',
      }),
      request(app).post(`/api/research/items/${id}/annotation`).send({
        labels: ['white_area'],
        anatomical_region: 'inner_cheek',
      }),
      request(app).post(`/api/research/datasets/${id}/seal`).send({}),
    ];
    const unauthenticated = await Promise.all(protectedRequests);
    expect(unauthenticated.map((response) => response.status)).toEqual(
      Array(protectedRequests.length).fill(401),
    );

    await request(app).get('/api/research/consent').set(auth('admin')).expect(403);
    await request(app)
      .post('/api/research/consent')
      .set(auth('doctor'))
      .send({ research_ai_training: true, language: 'en' })
      .expect(403);
    await request(app).post('/api/research/consent/withdraw').set(auth('admin')).send({}).expect(403);
    await request(app).get('/api/research/datasets').set(auth('patient1')).expect(403);
    await request(app).get(`/api/research/datasets/${id}/items`).set(auth('health_worker')).expect(403);
    await request(app)
      .post('/api/research/datasets')
      .set(auth('doctor'))
      .send({ name: 'Test dataset', version: 'v1' })
      .expect(403);
    await request(app)
      .post(`/api/research/datasets/${id}/items`)
      .set(auth('doctor'))
      .send({ image_id: id, consent_record_id: id, split: 'train' })
      .expect(403);
    await request(app)
      .post(`/api/research/items/${id}/annotation`)
      .set(auth('admin'))
      .send({ labels: ['white_area'], anatomical_region: 'inner_cheek' })
      .expect(403);
    await request(app)
      .post(`/api/research/datasets/${id}/seal`)
      .set(auth('doctor'))
      .send({})
      .expect(403);

    const ownStatus = await request(app).get('/api/research/consent').set(auth('patient2')).expect(200);
    expect(ownStatus.body.data.history).toEqual([]);
    await request(app)
      .post('/api/research/consent/withdraw')
      .set(auth('patient2'))
      .send({})
      .expect(409);
  });

  it('runs consent, enrollment, pseudonymization, annotation, sealing, and integrity verification end to end', async () => {
    const firstGrant = await grantConsent(1);
    expect(firstGrant).toMatchObject({
      consent_version: 'integration-v1',
      purpose: 'research_ai_training',
      status: 'granted',
      sequence: 1,
    });

    const datasetResponse = await request(app)
      .post('/api/research/datasets')
      .set(auth('admin'))
      .send({ name: 'Synthetic integration dataset', version: 'v1', description: 'test only' })
      .expect(201);
    dataset = datasetResponse.body.data.dataset;
    await request(app).get('/api/research/datasets').set(auth('admin')).expect(200);

    await enroll(imageIds.patient4[0], firstGrant, 'train').expect(403);
    const withdrawn = await request(app)
      .post('/api/research/consent/withdraw')
      .set(auth('patient1'))
      .send({})
      .expect(200);
    expect(withdrawn.body.data.withdrawn_at).toBeTruthy();
    await enroll(imageIds.patient1[0], firstGrant, 'train').expect(403);

    process.env.RESEARCH_CONSENT_VERSION = 'integration-v2';
    const patient1Grant = await grantConsent(1);
    expect(patient1Grant).toMatchObject({ consent_version: 'integration-v2', sequence: 3 });
    const patient2Grant = await grantConsent(2);
    const patient3Grant = await grantConsent(3);

    const previousKey = process.env.RESEARCH_SUBJECT_HMAC_KEY;
    delete process.env.RESEARCH_SUBJECT_HMAC_KEY;
    await enroll(imageIds.patient1[0], patient1Grant, 'train').expect(503);
    process.env.RESEARCH_SUBJECT_HMAC_KEY = 'too-short';
    await enroll(imageIds.patient1[0], patient1Grant, 'train').expect(503);
    process.env.RESEARCH_SUBJECT_HMAC_KEY = previousKey;

    const firstItem = await enroll(imageIds.patient1[0], patient1Grant, 'train').expect(201);
    const secondSameParticipant = await enroll(imageIds.patient1[1], patient1Grant, 'train').expect(201);
    const secondParticipant = await enroll(imageIds.patient2[0], patient2Grant, 'validation').expect(201);
    const thirdParticipant = await enroll(imageIds.patient3[0], patient3Grant, 'test').expect(201);
    expect(secondSameParticipant.body.data.item.subject_key).toBe(
      firstItem.body.data.item.subject_key,
    );
    expect(secondParticipant.body.data.item.subject_key).not.toBe(
      firstItem.body.data.item.subject_key,
    );
    expect(thirdParticipant.body.data.item.subject_key).not.toBe(
      secondParticipant.body.data.item.subject_key,
    );
    await enroll(imageIds.patient1[1], patient1Grant, 'test').expect(409);
    await enroll(imageIds.patient1[1], patient1Grant, 'train').expect(409);

    const itemIds = [
      firstItem.body.data.item.id,
      secondSameParticipant.body.data.item.id,
      secondParticipant.body.data.item.id,
      thirdParticipant.body.data.item.id,
    ];
    const openItems = await request(app)
      .get(`/api/research/datasets/${dataset.id}/items`)
      .set(auth('doctor'))
      .expect(200);
    expect(openItems.body.data.items).toHaveLength(4);
    expect(openItems.body.data.items.map((item) => item.split)).toEqual(
      expect.arrayContaining(['train', 'validation', 'test']),
    );
    expect(JSON.stringify(openItems.body.data)).not.toMatch(
      /Synthetic Research Participant|800000|example\.invalid|patient_id|screening_id/i,
    );
    expect(openItems.body.data.manifest.items.map((entry) => entry.split)).toEqual(
      expect.arrayContaining(['train', 'validation', 'test']),
    );

    await request(app)
      .post(`/api/research/items/${itemIds[0]}/annotation`)
      .set(auth('admin'))
      .send({ labels: ['white_area'], anatomical_region: 'inner_cheek' })
      .expect(403);
    for (const [index, itemId] of itemIds.entries()) {
      await request(app)
        .post(`/api/research/items/${itemId}/annotation`)
        .set(auth(index === 1 ? 'specialist' : 'doctor'))
        .send({ labels: ['white_area'], anatomical_region: 'inner_cheek' })
        .expect(201);
    }
    const annotationAudits = await db
      .collection('audit_logs')
      .find({ action: 'research.annotation_reviewed' })
      .toArray();
    expect(annotationAudits).toHaveLength(itemIds.length);
    expect(annotationAudits.some((entry) => entry.user_id === users.doctor.id)).toBe(true);
    expect(annotationAudits.some((entry) => entry.user_id === users.specialist.id)).toBe(true);

    const annotated = await request(app)
      .get(`/api/research/datasets/${dataset.id}/items`)
      .set(auth('specialist'))
      .expect(200);
    const manifestEntries = annotated.body.data.manifest.items;
    expect(validateManifest(manifestEntries)).toMatchObject({
      entries: 4,
      subjects: 3,
      splits: ['test', 'train', 'validation'],
    });
    expect(() =>
      validateManifest(
        manifestEntries.map((entry, index) =>
          index === 0 ? { ...entry, patient_id: patients.patient1 } : entry,
        ),
      ),
    ).toThrow(/direct identifiers/);
    expect(() =>
      validateManifest([
        ...manifestEntries,
        { ...manifestEntries[0], item_id: randomUUID(), split: 'test' },
      ]),
    ).toThrow(/multiple splits/);

    const sealed = await request(app)
      .post(`/api/research/datasets/${dataset.id}/seal`)
      .set(auth('admin'))
      .send({})
      .expect(200);
    expect(sealed.body.data.dataset.status).toBe('sealed');
    expect(sealed.body.data.dataset.manifest_hash).toMatch(/^[a-f0-9]{64}$/);

    const verified = await request(app)
      .get(`/api/research/datasets/${dataset.id}/items`)
      .set(auth('admin'))
      .expect(200);
    expect(verified.body.data.dataset.manifest_hash_verified).toBe(true);
    expect(verified.body.data.dataset.manifest_hash).toBe(
      verified.body.data.manifest.sha256,
    );
    await request(app)
      .post(`/api/research/datasets/${dataset.id}/items`)
      .set(auth('admin'))
      .send({
        image_id: imageIds.patient4[0],
        consent_record_id: patient1Grant.id,
        split: 'train',
      })
      .expect(404);
    await request(app)
      .post(`/api/research/items/${itemIds[0]}/annotation`)
      .set(auth('doctor'))
      .send({ labels: ['red_area'], anatomical_region: 'tongue' })
      .expect(409)
      .then((response) => expect(response.body.code).toBe('DATASET_SEALED'));
    await request(app)
      .post(`/api/research/datasets/${dataset.id}/seal`)
      .set(auth('admin'))
      .send({})
      .expect(404);

    const withdrawal = await request(app)
      .post('/api/research/consent/withdraw')
      .set(auth('patient2'))
      .send({})
      .expect(200);
    expect(withdrawal.body.data.status).toBe('withdrawn');
    const afterWithdrawal = await request(app)
      .get(`/api/research/datasets/${dataset.id}/items`)
      .set(auth('admin'))
      .expect(200);
    expect(afterWithdrawal.body.data.dataset.manifest_hash_verified).toBe(true);
    expect(afterWithdrawal.body.data.items).toHaveLength(2);
    expect(afterWithdrawal.body.data.items.map((item) => item.subject_key)).not.toContain(
      secondParticipant.body.data.item.subject_key,
    );
    expect(afterWithdrawal.body.data.manifest.item_count).toBe(2);
    await request(app)
      .post(`/api/research/items/${itemIds[2]}/annotation`)
      .set(auth('doctor'))
      .send({ labels: ['red_area'], anatomical_region: 'tongue' })
      .expect(409);

    await db.collection('research_dataset_items').updateOne(
      { id: itemIds[0] },
      { $set: { subject_key: 'tampered-manifest-subject' } },
    );
    const tampered = await request(app)
      .get(`/api/research/datasets/${dataset.id}/items`)
      .set(auth('admin'))
      .expect(409);
    expect(tampered.body.code).toBe('DATASET_MANIFEST_INVALID');

    const consentHistory = await request(app)
      .get('/api/research/consent')
      .set(auth('patient1'))
      .expect(200);
    expect(consentHistory.body.data.history.map((entry) => entry.sequence)).toEqual([3, 2, 1]);
    expect(consentHistory.body.data.history[0].consent_version).toBe('integration-v2');
  });
});
