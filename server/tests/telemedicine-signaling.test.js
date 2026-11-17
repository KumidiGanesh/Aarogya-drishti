process.env.JWT_ACCESS_SECRET = 'telemedicine-signaling-test-access-secret';
process.env.CALL_TOKEN_SECRET = 'telemedicine-signaling-test-call-secret-at-least-32';
process.env.STUN_URIS = 'stun:stun.example.test:3478';
process.env.TURN_URIS = 'turns:turn.example.test:5349';
process.env.TURN_SHARED_SECRET = 'telemedicine-signaling-turn-shared-secret-at-least-32';
process.env.NODE_ENV = 'test';

jest.mock('../src/db/mongo', () => {
  const mongoMock = require('./helpers/mongoMock');
  return {
    ...mongoMock,
    getDb: jest.fn(async () => mongoMock.getDb()),
  };
});

const http = require('node:http');
const jwt = require('jsonwebtoken');
const { io: connectSocket } = require('socket.io-client');
const app = require('../src/app');
const mongoMock = require('./helpers/mongoMock');
const { DEFAULT_ROLE_PERMISSIONS } = require('../src/auth/permissions');
const { attachTelemedicineSockets } = require('../src/telemedicine/signaling');

const ids = {
  patient: 'c4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  doctor: 'd4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  patientUser: 'e4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  doctorUser: 'f4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  appointment: 'a4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  consultation: 'a5b33580-1c35-4ae3-bf49-1f35532fd3ce',
  patientSession: 'b4b33580-1c35-4ae3-bf49-1f35532fd3ce',
  doctorSession: 'b5b33580-1c35-4ae3-bf49-1f35532fd3ce',
};

let server;
let ioServer;
let clients;

function seed(name, ...documents) {
  for (const document of documents) mongoMock.insert(name, document);
}

function accessToken(role) {
  const sub = role === 'patient' ? ids.patientUser : ids.doctorUser;
  const sid = role === 'patient' ? ids.patientSession : ids.doctorSession;
  return jwt.sign(
    {
      role,
      permissions: DEFAULT_ROLE_PERMISSIONS[role],
      pv: 1,
      sid,
    },
    process.env.JWT_ACCESS_SECRET,
    { subject: sub, expiresIn: '5m' },
  );
}

function seedSession(userId, role, sessionId) {
  seed('users', {
    id: userId,
    full_name: role === 'doctor' ? 'Assigned clinician' : 'Registered patient',
    role,
    is_active: true,
    deleted_at: null,
    permissions_version: 1,
    preferred_language: 'en',
  });
  seed('roles', {
    name: role,
    is_system: true,
    permissions_version: 1,
  });
  seed('refresh_tokens', {
    id: sessionId,
    user_id: userId,
    revoked_at: null,
    expires_at: new Date(Date.now() + 60_000),
  });
}

function seedCallRecords() {
  const now = new Date();
  seedSession(ids.patientUser, 'patient', ids.patientSession);
  seedSession(ids.doctorUser, 'doctor', ids.doctorSession);
  seed('patients', {
    id: ids.patient,
    user_id: ids.patientUser,
    full_name: 'Registered patient',
    patient_code: 'AD-2026-000001',
    is_active: true,
    deleted_at: null,
  });
  seed('doctors', {
    id: ids.doctor,
    user_id: ids.doctorUser,
    specialty: 'Dental',
  });
  seed('appointments', {
    id: ids.appointment,
    patient_id: ids.patient,
    doctor_id: ids.doctor,
    scheduled_at: now,
    status: 'confirmed',
    mode: 'video',
    deleted_at: null,
  });
  seed('consultations', {
    id: ids.consultation,
    appointment_id: ids.appointment,
    patient_id: ids.patient,
    doctor_id: ids.doctor,
    status: 'scheduled',
    created_at: now,
  });
  seed('patient_consents', {
    patient_id: ids.patient,
    consent_type: 'teleconsultation',
    granted: true,
  });
}

async function startServer() {
  server = http.createServer(app);
  ioServer = attachTelemedicineSockets(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function connect(url, token) {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(url, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
    });
    clients.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => reject(error));
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(3000).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3000);
    socket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

async function waitForCondition(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

beforeEach(() => {
  mongoMock.reset();
  clients = [];
  seedCallRecords();
});

afterEach(async () => {
  for (const socket of clients) socket.disconnect();
  if (ioServer) {
    await new Promise((resolve) => ioServer.close(resolve));
  } else if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  ioServer = undefined;
  server = undefined;
});

describe('authenticated telemedicine Socket.IO signaling', () => {
  it('rejects unauthenticated WebSocket connections', async () => {
    const url = await startServer();
    await expect(connect(url)).rejects.toMatchObject({ message: 'UNAUTHENTICATED' });
  });

  it('routes calls only to authorized participants and relays signaling after token-based room join', async () => {
    const url = await startServer();
    const doctor = await connect(url, accessToken('doctor'));
    const patient = await connect(url, accessToken('patient'));

    const incomingEvent = waitForEvent(doctor, 'call:incoming');
    const initiated = await emitAck(patient, 'call:initiate', {
      consultation_id: ids.consultation,
    });
    expect(initiated).toMatchObject({
      success: true,
      data: { status: 'ringing', recipient_online: true },
    });
    expect(initiated.data.ice_servers).toEqual(expect.arrayContaining([
      { urls: ['stun:stun.example.test:3478'] },
      expect.objectContaining({ urls: ['turns:turn.example.test:5349'] }),
    ]));
    const incoming = await incomingEvent;
    expect(incoming).toMatchObject({
      consultation_id: ids.consultation,
      caller_name: 'Registered patient',
      patient_code: 'AD-2026-000001',
      type: 'video',
    });
    expect(incoming.call_token).toEqual(expect.any(String));
    expect(incoming.ice_servers).toEqual(expect.arrayContaining([
      { urls: ['stun:stun.example.test:3478'] },
      expect.objectContaining({ urls: ['turns:turn.example.test:5349'] }),
    ]));

    const busyEvent = waitForEvent(patient, 'call:busy');
    const busyResult = await emitAck(patient, 'call:initiate', {
      consultation_id: ids.consultation,
    });
    expect(busyResult).toMatchObject({ success: false, code: 'CALL_BUSY' });
    await expect(busyEvent).resolves.toMatchObject({ code: 'CALL_BUSY' });

    const badJoin = await emitAck(patient, 'call:join', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      call_token: 'not-a-valid-token',
    });
    expect(badJoin).toMatchObject({ success: false, code: 'INVALID_CALL_TOKEN' });

    const acceptedEvent = waitForEvent(patient, 'call:accept');
    const accepted = await emitAck(doctor, 'call:accept', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
    });
    expect(accepted).toMatchObject({ success: true, data: { status: 'accepted' } });
    await expect(acceptedEvent).resolves.toMatchObject({ status: 'accepted' });

    await expect(
      emitAck(doctor, 'call:join', {
        consultation_id: ids.consultation,
        call_id: initiated.data.id,
        call_token: initiated.data.call_token,
      }),
    ).resolves.toMatchObject({ success: false, code: 'FORBIDDEN' });

    const patientJoined = await emitAck(patient, 'call:join', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      call_token: initiated.data.call_token,
    });
    expect(patientJoined).toMatchObject({ success: true, data: { peer_present: false } });
    expect(mongoMock.all('consultation_calls')[0].connected_at).toBeNull();
    expect(mongoMock.all('consultations')[0].status).toBe('waiting');
    const doctorJoinedEvent = waitForEvent(patient, 'participant:joined');
    const doctorJoined = await emitAck(doctor, 'call:join', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      call_token: incoming.call_token,
    });
    expect(doctorJoined).toMatchObject({ success: true, data: { peer_present: true } });
    expect(new Date(mongoMock.all('consultation_calls')[0].connected_at).getTime()).toBeGreaterThan(0);
    expect(mongoMock.all('consultations')[0].status).toBe('in_progress');
    await expect(doctorJoinedEvent).resolves.toMatchObject({ role: 'doctor' });

    const offerEvent = waitForEvent(doctor, 'call:offer');
    const offer = await emitAck(patient, 'call:offer', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      description: { type: 'offer', sdp: 'v=0\r\n' },
    });
    expect(offer).toMatchObject({ success: true, data: { relayed: true } });
    await expect(offerEvent).resolves.toMatchObject({
      description: { type: 'offer', sdp: 'v=0\r\n' },
    });

    const answerEvent = waitForEvent(patient, 'call:answer');
    const answer = await emitAck(doctor, 'call:answer', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      description: { type: 'answer', sdp: 'v=0\r\n' },
    });
    expect(answer).toMatchObject({ success: true, data: { relayed: true } });
    await expect(answerEvent).resolves.toMatchObject({
      description: { type: 'answer', sdp: 'v=0\r\n' },
    });

    const candidateEvent = waitForEvent(doctor, 'call:ice-candidate');
    const candidate = await emitAck(patient, 'call:ice-candidate', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      candidate: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 5000 typ host', sdpMid: '0' },
    });
    expect(candidate).toMatchObject({ success: true, data: { relayed: true } });
    await expect(candidateEvent).resolves.toMatchObject({
      candidate: { candidate: 'candidate:1 1 UDP 1 127.0.0.1 5000 typ host', sdpMid: '0' },
    });

    const endedEvent = waitForEvent(patient, 'call:end');
    const ended = await emitAck(doctor, 'call:end', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
    });
    expect(ended).toMatchObject({ success: true, data: { status: 'ended' } });
    await expect(endedEvent).resolves.toMatchObject({ status: 'ended' });
    expect(mongoMock.all('consultation_calls')[0]).not.toHaveProperty('call_token');
    expect(mongoMock.all('consultations')[0].status).toBe('completed');
  });

  it('rejects malformed or out-of-room signaling payloads', async () => {
    const url = await startServer();
    const patient = await connect(url, accessToken('patient'));
    const invalid = await emitAck(patient, 'call:initiate', { consultation_id: 'bad-id' });
    expect(invalid).toMatchObject({ success: false, code: 'INVALID_SIGNAL_PAYLOAD' });

    const outOfRoom = await emitAck(patient, 'call:offer', {
      consultation_id: ids.consultation,
      call_id: ids.appointment,
      description: { type: 'offer', sdp: 'v=0\r\n' },
    });
    expect(outOfRoom).toMatchObject({ success: false, code: 'CALL_ROOM_REQUIRED' });
  });

  it('marks overdue ringing calls missed and notifies both participants', async () => {
    const url = await startServer();
    const patient = await connect(url, accessToken('patient'));
    const doctor = await connect(url, accessToken('doctor'));
    const incomingEvent = waitForEvent(doctor, 'call:incoming');
    const initiated = await emitAck(patient, 'call:initiate', {
      consultation_id: ids.consultation,
    });
    await incomingEvent;
    const db = await mongoMock.getDb();
    await db.collection('consultation_calls').updateOne(
      { id: initiated.data.id },
      { $set: { initiated_at: new Date(Date.now() - 46_000) } },
    );

    const missedEvent = waitForEvent(doctor, 'call:missed');
    const missed = await emitAck(patient, 'call:resume', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
    });

    expect(missed).toMatchObject({ success: false, code: 'CALL_NOT_RINGING' });
    await expect(missedEvent).resolves.toMatchObject({
      call_id: initiated.data.id,
      status: 'missed',
    });
    expect(mongoMock.all('consultation_calls')[0].status).toBe('missed');
  });

  it('expires presence on disconnect and allows an authorized call to resume', async () => {
    const url = await startServer();
    let patient = await connect(url, accessToken('patient'));
    const doctor = await connect(url, accessToken('doctor'));
    const incomingEvent = waitForEvent(doctor, 'call:incoming');
    const initiated = await emitAck(patient, 'call:initiate', {
      consultation_id: ids.consultation,
    });
    const incoming = await incomingEvent;
    await emitAck(doctor, 'call:accept', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
    });
    await emitAck(patient, 'call:join', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      call_token: initiated.data.call_token,
    });
    const doctorJoined = waitForEvent(patient, 'participant:joined');
    await emitAck(doctor, 'call:join', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      call_token: incoming.call_token,
    });
    await doctorJoined;

    const originalPresence = mongoMock.all('user_presence')
      .find((record) => record.user_id === ids.patientUser);
    expect(originalPresence).toBeDefined();
    const leftEvent = waitForEvent(doctor, 'participant:left');
    patient.disconnect();
    await expect(leftEvent).resolves.toMatchObject({
      call_id: initiated.data.id,
      role: 'patient',
    });
    await waitForCondition(() => {
      const record = mongoMock.all('user_presence')
        .find((entry) => entry.id === originalPresence.id);
      return record && record.expires_at.getTime() <= Date.now();
    }, 'Disconnected presence was not expired');

    patient = await connect(url, accessToken('patient'));
    const resumed = await emitAck(patient, 'call:resume', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
    });
    const joinedEvent = waitForEvent(doctor, 'participant:joined');
    const joined = await emitAck(patient, 'call:join', {
      consultation_id: ids.consultation,
      call_id: initiated.data.id,
      call_token: resumed.data.call_token,
    });

    expect(joined).toMatchObject({ success: true, data: { peer_present: true } });
    await expect(joinedEvent).resolves.toMatchObject({ role: 'patient' });
    expect(mongoMock.all('user_presence')
      .filter((record) => record.user_id === ids.patientUser)).toHaveLength(2);
  });
});
