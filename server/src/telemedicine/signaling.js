const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { z } = require('zod');
const authenticate = require('../middleware/authenticate');
const { getDb } = require('../db/mongo');
const consultations = require('../consultations/service');
const getAllowedOrigins = require('../utils/allowedOrigins');
const logger = require('../utils/logger');

const CALL_TOKEN_AUDIENCE = 'aarogya-telemedicine-call';
const PRESENCE_TTL_MS = 45_000;
const PRESENCE_HEARTBEAT_MS = 15_000;
const RING_TIMEOUT_MS = 45_000;
const CALL_JOIN_TIMEOUT_MS = 30_000;
const DISCONNECT_GRACE_MS = 20_000;
const SESSION_REFRESH_MS = 5_000;
const uuid = z.string().uuid();
const callReference = z.object({
  consultation_id: uuid,
  call_id: uuid,
}).strict();
const initiateSchema = z.object({ consultation_id: uuid }).strict();
const joinSchema = callReference.extend({
  call_token: z.string().min(1).max(4096),
}).strict();
const sessionDescription = (type) => z.object({
  type: z.literal(type),
  sdp: z.string().min(1).max(100_000),
}).strict();
const offerSchema = callReference.extend({ description: sessionDescription('offer') }).strict();
const answerSchema = callReference.extend({ description: sessionDescription('answer') }).strict();
const candidateSchema = z.object({
  candidate: z.object({
    candidate: z.string().max(4096),
    sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }).strict().nullable(),
}).strict();
const iceSchema = callReference.extend(candidateSchema.shape).strict();
const callEventSchema = callReference;

function failure(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function userRoom(userId) {
  return `user:${userId}`;
}

function callRoom(callId) {
  return `call:${callId}`;
}

function getCallTokenSecret() {
  const secret = process.env.CALL_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw failure(
      503,
      'CALL_SIGNALING_UNAVAILABLE',
      'Secure call signaling is not configured',
    );
  }
  return secret;
}

function createCallToken(user, call, socketId) {
  return jwt.sign(
    {
      type: 'telemedicine_call',
      call_id: call.id,
      consultation_id: call.consultation_id,
      appointment_id: call.appointment_id,
      mode: call.type,
      role: user.role,
      socket_id: socketId,
    },
    getCallTokenSecret(),
    {
      algorithm: 'HS256',
      audience: CALL_TOKEN_AUDIENCE,
      expiresIn: '2m',
      subject: user.sub,
      jwtid: randomUUID(),
    },
  );
}

function isTrustedSecureRequest(request) {
  if (request.socket?.encrypted || request.connection?.encrypted) return true;
  const configuredTrust = process.env.TRUST_PROXY;
  const trustsProxy = configuredTrust === 'true' ||
    (configuredTrust !== 'false' && process.env.NODE_ENV === 'production');
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return trustsProxy && forwardedProtocol === 'https';
}

function requestContext(user, socket) {
  return {
    user,
    ip: socket.handshake.address || null,
    get(header) {
      return header.toLowerCase() === 'user-agent'
        ? socket.handshake.headers['user-agent'] || ''
        : '';
    },
  };
}

function toPublicError(error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  return {
    success: false,
    code: error.code || 'SIGNALING_ERROR',
    message: status < 500 ? error.message : 'Call signaling could not be completed',
  };
}

function logSocketError(error, socket, event) {
  if (Number(error.status) < 500) return;
  logger.error('Telemedicine signaling event failed', {
    event,
    userId: socket.data.user?.sub,
    code: error.code || 'SIGNALING_ERROR',
    errorMessage: error.message,
  });
}

async function verifySocketSession(socket) {
  const claims = socket.data.user;
  if (!claims || claims.exp * 1000 <= Date.now()) {
    throw failure(401, 'SESSION_EXPIRED', 'Your session expired; reconnect to continue');
  }
  if (Date.now() - socket.data.sessionCheckedAt >= SESSION_REFRESH_MS) {
    socket.data.user = await authenticate.authenticateToken(
      socket.data.accessToken,
      '/socket.io',
    );
    socket.data.sessionCheckedAt = Date.now();
  }
  if (
    !['doctor', 'patient'].includes(socket.data.user.role) ||
    !Array.isArray(socket.data.user.permissions) ||
    !socket.data.user.permissions.includes('consultations:manage')
  ) {
    throw failure(403, 'FORBIDDEN', 'Telemedicine access is not allowed for this account');
  }
  return socket.data.user;
}

async function loadCall(db, consultationId, callId) {
  const call = await db.collection('consultation_calls').findOne({
    id: callId,
    consultation_id: consultationId,
  });
  if (!call) throw failure(404, 'CALL_NOT_FOUND', 'Call record not found');
  return call;
}

function getOtherParticipant(call, userId) {
  if (call.caller_user_id === userId) {
    return { user_id: call.recipient_user_id, role: call.recipient_role };
  }
  if (call.recipient_user_id === userId) {
    return { user_id: call.caller_user_id, role: call.caller_role };
  }
  throw failure(403, 'FORBIDDEN', 'You are not a participant in this call');
}

function sendToUser(io, userId, event, payload) {
  if (userId) io.to(userRoom(userId)).emit(event, payload);
}

async function sendIncoming(io, socket, call) {
  getCallTokenSecret();
  const iceConfiguration = await consultations.getIceServers(call.consultation_id, socket.data.user);
  const db = await getDb();
  const caller = await db.collection('users').findOne({ id: call.caller_user_id });
  let patientCode = null;
  if (socket.data.user.role === 'doctor' && call.caller_role === 'patient') {
    const consultation = await db.collection('consultations').findOne({ id: call.consultation_id });
    const patient = consultation
      ? await db.collection('patients').findOne({ id: consultation.patient_id })
      : null;
    patientCode = patient?.patient_code || null;
  }
  socket.emit('call:incoming', {
    call_id: call.id,
    consultation_id: call.consultation_id,
    type: call.type,
    caller_name: caller?.full_name || '',
    caller_role: call.caller_role,
    ...(patientCode ? { patient_code: patientCode } : {}),
    initiated_at: call.initiated_at,
    call_token: createCallToken(socket.data.user, call, socket.id),
    ice_servers: iceConfiguration.ice_servers,
  });
}

const ringTimers = new Map();
const joinTimers = new Map();
const disconnectTimers = new Map();

function clearRingTimer(callId) {
  const timer = ringTimers.get(callId);
  if (timer) clearTimeout(timer);
  ringTimers.delete(callId);
}

function clearJoinTimer(callId) {
  const timer = joinTimers.get(callId);
  if (timer) clearTimeout(timer);
  joinTimers.delete(callId);
}

function clearDisconnectTimer(callId, userId) {
  const key = `${callId}:${userId}`;
  const timer = disconnectTimers.get(key);
  if (timer) clearTimeout(timer);
  disconnectTimers.delete(key);
}

function scheduleRingTimeout(io, call) {
  clearRingTimer(call.id);
  const delay = Math.max(
    0,
    RING_TIMEOUT_MS - (Date.now() - new Date(call.initiated_at).getTime()),
  );
  const timer = setTimeout(() => {
    void expireCall(io, call);
  }, delay);
  timer.unref?.();
  ringTimers.set(call.id, timer);
}

async function expireCall(io, call) {
  try {
    const user = { sub: call.caller_user_id, role: call.caller_role };
    const result = await consultations.callAction(
      call.consultation_id,
      { action: 'missed', call_id: call.id },
      user,
      { user, ip: null, get: () => '' },
    );
    clearRingTimer(call.id);
    const event = {
      call_id: result.id,
      consultation_id: result.consultation_id,
      status: result.status,
    };
    sendToUser(io, call.caller_user_id, 'call:missed', event);
    sendToUser(io, call.recipient_user_id, 'call:missed', event);
  } catch (error) {
    clearRingTimer(call.id);
    if (!['CALL_NOT_RINGING', 'CALL_TIMEOUT_PENDING', 'CALL_STATUS_CHANGED'].includes(error.code)) {
      logger.error('Failed to expire an unanswered telemedicine call', {
        callId: call.id,
        errorMessage: error.message,
      });
    }
  }
}

function scheduleJoinTimeout(io, call) {
  clearJoinTimer(call.id);
  const timer = setTimeout(async () => {
    joinTimers.delete(call.id);
    try {
      const db = await getDb();
      const current = await db.collection('consultation_calls').findOne({
        id: call.id,
        status: 'accepted',
      });
      if (!current || (current.doctor_joined_at && current.patient_joined_at)) return;
      const user = { sub: current.caller_user_id, role: current.caller_role };
      const result = await consultations.callAction(
        current.consultation_id,
        { action: 'end', call_id: current.id, reason: 'connection_timeout' },
        user,
        { user, ip: null, get: () => '' },
      );
      sendToUser(io, current.caller_user_id, 'call:end', {
        call_id: result.id,
        consultation_id: result.consultation_id,
        status: result.status,
        reason: 'connection_timeout',
      });
      sendToUser(io, current.recipient_user_id, 'call:end', {
        call_id: result.id,
        consultation_id: result.consultation_id,
        status: result.status,
        reason: 'connection_timeout',
      });
      io.in(callRoom(current.id)).socketsLeave(callRoom(current.id));
    } catch (error) {
      logger.error('Failed to close a telemedicine call that did not connect', {
        callId: call.id,
        errorMessage: error.message,
      });
    }
  }, CALL_JOIN_TIMEOUT_MS);
  timer.unref?.();
  joinTimers.set(call.id, timer);
}

async function expireOldRingingCalls(io) {
  const db = await getDb();
  const calls = await db.collection('consultation_calls')
    .find({
      status: 'ringing',
      initiated_at: { $lte: new Date(Date.now() - RING_TIMEOUT_MS) },
    })
    .limit(100)
    .toArray();
  for (const call of calls) await expireCall(io, call);
}

async function setPresence(socket) {
  const db = await getDb();
  const id = randomUUID();
  const now = new Date();
  await db.collection('user_presence').insertOne({
    id,
    user_id: socket.data.user.sub,
    role: socket.data.user.role,
    last_seen_at: now,
    expires_at: new Date(now.getTime() + PRESENCE_TTL_MS),
  });
  socket.data.presenceId = id;
  socket.data.presenceTimer = setInterval(async () => {
    try {
      const current = new Date();
      await db.collection('user_presence').updateOne(
        { id },
        {
          $set: {
            last_seen_at: current,
            expires_at: new Date(current.getTime() + PRESENCE_TTL_MS),
          },
        },
      );
    } catch (error) {
      logger.error('Failed to refresh telemedicine presence', {
        userId: socket.data.user.sub,
        errorMessage: error.message,
      });
    }
  }, PRESENCE_HEARTBEAT_MS);
  socket.data.presenceTimer.unref?.();
}

async function clearPresence(socket) {
  if (socket.data.presenceTimer) clearInterval(socket.data.presenceTimer);
  if (!socket.data.presenceId) return;
  try {
    const db = await getDb();
    const now = new Date();
    await db.collection('user_presence').updateOne(
      { id: socket.data.presenceId },
      { $set: { last_seen_at: now, expires_at: now } },
    );
  } catch (error) {
    logger.error('Failed to clear telemedicine presence', {
      userId: socket.data.user.sub,
      errorMessage: error.message,
    });
  }
}

function sendAckError(socket, event, acknowledge, error) {
  logSocketError(error, socket, event);
  const result = toPublicError(error);
  if (event === 'call:initiate' && error.code === 'CALL_BUSY') {
    socket.emit('call:busy', { code: error.code, message: error.message });
  }
  if (typeof acknowledge === 'function') acknowledge(result);
  else socket.emit('call:error', { event, ...result });
  if (result.code === 'SESSION_EXPIRED' || result.code === 'SESSION_REVOKED') {
    socket.disconnect(true);
  }
}

function bindEvent(socket, event, schema, handler) {
  socket.on(event, (payload, acknowledge) => {
    void (async () => {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw failure(400, 'INVALID_SIGNAL_PAYLOAD', 'The signaling event payload is invalid');
      }
      const user = await verifySocketSession(socket);
      return handler(parsed.data, user);
    })()
      .then((data) => {
        if (typeof acknowledge === 'function') acknowledge({ success: true, data });
      })
      .catch((error) => sendAckError(socket, event, acknowledge, error));
  });
}

async function emitIncomingToOnlineRecipient(io, call) {
  const sockets = await io.in(userRoom(call.recipient_user_id)).fetchSockets();
  for (const socket of sockets) await sendIncoming(io, socket, call);
  return sockets.length > 0;
}

async function handleInitiate(io, socket, data, user) {
  getCallTokenSecret();
  const iceConfiguration = await consultations.getIceServers(data.consultation_id, user);
  const req = requestContext(user, socket);
  const result = await consultations.callAction(
    data.consultation_id,
    { action: 'initiate' },
    user,
    req,
  );
  const db = await getDb();
  const call = await loadCall(db, result.consultation_id, result.id);
  const callToken = createCallToken(user, call, socket.id);
  const recipientOnline = await emitIncomingToOnlineRecipient(io, call);
  scheduleRingTimeout(io, call);
  return {
    ...result,
    recipient_online: recipientOnline,
    call_token: callToken,
    ice_servers: iceConfiguration.ice_servers,
  };
}

async function mutateCall(io, socket, data, user, action) {
  const req = requestContext(user, socket);
  const db = await getDb();
  const call = await loadCall(db, data.consultation_id, data.call_id);
  const otherParticipant = getOtherParticipant(call, user.sub);
  const result = await consultations.callAction(
    data.consultation_id,
    { action, call_id: data.call_id },
    user,
    req,
  );
  if (action === 'accept' || action === 'reject') clearRingTimer(call.id);
  if (action === 'accept') scheduleJoinTimeout(io, call);
  if (action === 'reject' || action === 'end') clearJoinTimer(call.id);
  const eventName =
    action === 'accept' ? 'call:accept' : action === 'reject' ? 'call:reject' : 'call:end';
  sendToUser(io, otherParticipant.user_id, eventName, {
    call_id: result.id,
    consultation_id: result.consultation_id,
    type: result.type,
    status: result.status,
    ended_at: result.ended_at,
    duration_seconds: result.duration_seconds,
  });
  if (action === 'end' || action === 'reject') {
    const room = callRoom(call.id);
    io.in(room).socketsLeave(room);
  }
  return result;
}

function verifyCallToken(socket, token, call) {
  let claims;
  try {
    claims = jwt.verify(token, getCallTokenSecret(), {
      algorithms: ['HS256'],
      audience: CALL_TOKEN_AUDIENCE,
    });
  } catch {
    throw failure(401, 'INVALID_CALL_TOKEN', 'The call authorization expired or is invalid');
  }
  const user = socket.data.user;
  if (
    claims.type !== 'telemedicine_call' ||
    claims.sub !== user.sub ||
    claims.role !== user.role ||
    claims.socket_id !== socket.id ||
    claims.call_id !== call.id ||
    claims.consultation_id !== call.consultation_id ||
    claims.appointment_id !== call.appointment_id ||
    ![call.caller_user_id, call.recipient_user_id].includes(user.sub)
  ) {
    throw failure(403, 'FORBIDDEN', 'This call authorization does not match your appointment');
  }
  return claims;
}

async function authorizeCallJoin(socket, data) {
  const db = await getDb();
  const call = await loadCall(db, data.consultation_id, data.call_id);
  verifyCallToken(socket, data.call_token, call);
  if (call.status !== 'accepted') {
    throw failure(409, 'CALL_NOT_ACCEPTED', 'The other participant has not accepted this call');
  }
  const consultation = await db.collection('consultations').findOne({
    id: data.consultation_id,
  });
  const appointment = await db.collection('appointments').findOne({ id: call.appointment_id });
  const scheduledAt = new Date(appointment?.scheduled_at).getTime();
  const now = Date.now();
  const appointmentWindowOpen = Number.isFinite(scheduledAt) &&
    now >= scheduledAt - 30 * 60_000 &&
    now <= scheduledAt + 60 * 60_000;
  if (
    !consultation ||
    !appointment ||
    appointment.deleted_at ||
    !['booked', 'confirmed', 'rescheduled'].includes(appointment.status) ||
    !appointmentWindowOpen ||
    !['audio', 'video'].includes(appointment.mode) ||
    !['waiting', 'in_progress'].includes(consultation.status)
  ) {
    throw failure(409, 'APPOINTMENT_NOT_ACTIVE', 'This appointment is no longer available for a call');
  }
  const consent = await db.collection('patient_consents').findOne({
    patient_id: consultation.patient_id,
    consent_type: 'teleconsultation',
    granted: true,
  });
  if (!consent) {
    throw failure(422, 'TELECONSULTATION_CONSENT_REQUIRED', 'Active teleconsultation consent is required');
  }
  return { db, call };
}

async function handleJoin(io, socket, data) {
  const { db, call } = await authorizeCallJoin(socket, data);
  const room = callRoom(call.id);
  await socket.join(room);
  socket.data.callRooms = socket.data.callRooms || {};
  socket.data.callRooms[call.id] = {
    consultation_id: call.consultation_id,
    room,
  };
  const now = new Date();
  const user = socket.data.user;
  const participantField = user.role === 'doctor' ? 'doctor_joined_at' : 'patient_joined_at';
  const leftField = user.role === 'doctor' ? 'doctor_left_at' : 'patient_left_at';
  await db.collection('consultation_calls').updateOne(
    { id: call.id, status: 'accepted' },
    {
      $set: {
        [participantField]: now,
        [leftField]: null,
        updated_at: now,
      },
    },
  );
  const updatedCall = await db.collection('consultation_calls').findOne({ id: call.id });
  const connected = Boolean(updatedCall?.doctor_joined_at && updatedCall?.patient_joined_at);
  if (connected) {
    clearJoinTimer(call.id);
    if (!updatedCall.connected_at) {
      await db.collection('consultation_calls').updateOne(
        { id: call.id, status: 'accepted', connected_at: null },
        { $set: { connected_at: now, updated_at: now } },
      );
    }
    await db.collection('consultations').updateOne(
      { id: call.consultation_id, status: { $in: ['scheduled', 'waiting'] } },
      { $set: { status: 'in_progress', started_at: now, updated_at: now } },
    );
  }
  clearDisconnectTimer(call.id, user.sub);
  socket.to(room).emit('participant:joined', {
    call_id: call.id,
    consultation_id: call.consultation_id,
    role: user.role,
  });
  const members = await io.in(room).fetchSockets();
  return {
    call_id: call.id,
    consultation_id: call.consultation_id,
    status: call.status,
    connected,
    peer_present: members.some((member) => member.data.user?.sub !== user.sub),
  };
}

async function handleResume(io, socket, data, user) {
  const db = await getDb();
  const call = await loadCall(db, data.consultation_id, data.call_id);
  if (
    ![call.caller_user_id, call.recipient_user_id].includes(user.sub) ||
    !['ringing', 'accepted'].includes(call.status)
  ) {
    throw failure(403, 'FORBIDDEN', 'This call cannot be resumed by your account');
  }
  if (call.status === 'ringing') {
    const elapsed = Date.now() - new Date(call.initiated_at).getTime();
    if (elapsed >= RING_TIMEOUT_MS) {
      await expireCall(io, call);
      throw failure(409, 'CALL_NOT_RINGING', 'This call has already timed out');
    }
    if (call.recipient_user_id === user.sub) await sendIncoming(io, socket, call);
    scheduleRingTimeout(io, call);
  }
  clearDisconnectTimer(call.id, user.sub);
  return {
    call_id: call.id,
    consultation_id: call.consultation_id,
    status: call.status,
    call_token: createCallToken(user, call, socket.id),
    ice_servers: (await consultations.getIceServers(call.consultation_id, user)).ice_servers,
  };
}

async function relaySignal(socket, event, data) {
  const membership = socket.data.callRooms?.[data.call_id];
  if (!membership || membership.consultation_id !== data.consultation_id) {
    throw failure(403, 'CALL_ROOM_REQUIRED', 'Join this authorized call before sending media signals');
  }
  const db = await getDb();
  const call = await db.collection('consultation_calls').findOne({
    id: data.call_id,
    consultation_id: data.consultation_id,
    status: 'accepted',
  });
  if (!call || ![call.caller_user_id, call.recipient_user_id].includes(socket.data.user.sub)) {
    throw failure(403, 'FORBIDDEN', 'You are not an active participant in this call');
  }
  socket.to(membership.room).emit(event, {
    call_id: data.call_id,
    consultation_id: data.consultation_id,
    ...(data.description ? { description: data.description } : {}),
    ...(Object.hasOwn(data, 'candidate') ? { candidate: data.candidate } : {}),
  });
  return { relayed: true };
}

async function scheduleDisconnectEnd(io, callId, consultationId, user) {
  const key = `${callId}:${user.sub}`;
  clearDisconnectTimer(callId, user.sub);
  const timer = setTimeout(async () => {
    disconnectTimers.delete(key);
    try {
      const connected = await io.in(userRoom(user.sub)).fetchSockets();
      if (connected.length) return;
      const db = await getDb();
      const call = await db.collection('consultation_calls').findOne({
        id: callId,
        consultation_id: consultationId,
        status: 'accepted',
      });
      if (!call) return;
      const other = getOtherParticipant(call, user.sub);
      const result = await consultations.callAction(
        consultationId,
        { action: 'end', call_id: callId },
        user,
        { user, ip: null, get: () => '' },
      );
      sendToUser(io, other.user_id, 'call:end', {
        call_id: result.id,
        consultation_id: result.consultation_id,
        status: result.status,
        reason: 'participant_disconnected',
        duration_seconds: result.duration_seconds,
      });
      io.in(callRoom(callId)).socketsLeave(callRoom(callId));
    } catch (error) {
      logger.error('Failed to close a disconnected telemedicine call', {
        callId,
        userId: user.sub,
        errorMessage: error.message,
      });
    }
  }, DISCONNECT_GRACE_MS);
  timer.unref?.();
  disconnectTimers.set(key, timer);
}

async function onDisconnect(io, socket) {
  await clearPresence(socket);
  for (const [callId, membership] of Object.entries(socket.data.callRooms || {})) {
    const remaining = await io.in(membership.room).fetchSockets();
    if (remaining.some((member) => member.data.user?.sub === socket.data.user.sub)) continue;
    const now = new Date();
    const leftField = socket.data.user.role === 'doctor' ? 'doctor_left_at' : 'patient_left_at';
    const db = await getDb();
    await db.collection('consultation_calls').updateOne(
      { id: callId, status: 'accepted' },
      { $set: { [leftField]: now, updated_at: now } },
    );
    io.to(membership.room).emit('participant:left', {
      call_id: callId,
      consultation_id: membership.consultation_id,
      role: socket.data.user.role,
    });
    const call = await db.collection('consultation_calls').findOne({
      id: callId,
      status: 'accepted',
    });
    if (call) {
      await scheduleDisconnectEnd(io, callId, membership.consultation_id, {
        sub: socket.data.user.sub,
        role: socket.data.user.role,
      });
    }
  }
}

async function sendPendingCalls(io, socket) {
  const db = await getDb();
  const calls = await db.collection('consultation_calls')
    .find({ recipient_user_id: socket.data.user.sub, status: 'ringing' })
    .sort({ initiated_at: 1 })
    .limit(10)
    .toArray();
  for (const call of calls) {
    const elapsed = Date.now() - new Date(call.initiated_at).getTime();
    if (elapsed >= RING_TIMEOUT_MS) {
      await expireCall(io, call);
      continue;
    }
    await sendIncoming(io, socket, call);
    scheduleRingTimeout(io, call);
  }
}

function attachTelemedicineSockets(httpServer) {
  const allowedOrigins = getAllowedOrigins();
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) callback(null, true);
        else callback(new Error('Origin is not allowed by CORS'));
      },
      credentials: true,
    },
    allowRequest(request, callback) {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        callback('Origin is not allowed by CORS', false);
        return;
      }
      if (process.env.NODE_ENV === 'production' && !isTrustedSecureRequest(request)) {
        callback('HTTPS is required', false);
        return;
      }
      callback(null, true);
    },
    maxHttpBufferSize: 128 * 1024,
    perMessageDeflate: false,
  });

  io.use(async (socket, next) => {
    try {
      if (process.env.NODE_ENV === 'production' && !isTrustedSecureRequest(socket.request)) {
        throw failure(426, 'HTTPS_REQUIRED', 'Secure WebSocket transport is required');
      }
      const token = socket.handshake.auth?.token;
      const user = await authenticate.authenticateToken(token, '/socket.io');
      if (
        !['doctor', 'patient'].includes(user.role) ||
        !Array.isArray(user.permissions) ||
        !user.permissions.includes('consultations:manage')
      ) {
        throw failure(403, 'FORBIDDEN', 'Telemedicine access is not allowed for this account');
      }
      socket.data.user = user;
      socket.data.accessToken = token;
      socket.data.sessionCheckedAt = Date.now();
      next();
    } catch (error) {
      if (Number(error.status) >= 500) {
        logger.error('Socket authentication failed', { errorMessage: error.message });
      }
      next(new Error(error.code || 'UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.user.sub));
    void (async () => {
      await setPresence(socket);
      await sendPendingCalls(io, socket);
    })().catch((error) => {
      logger.error('Failed to initialize telemedicine socket', {
        userId: socket.data.user.sub,
        errorMessage: error.message,
      });
      socket.disconnect(true);
    });

    bindEvent(socket, 'call:initiate', initiateSchema, (data, user) =>
      handleInitiate(io, socket, data, user));
    bindEvent(socket, 'call:accept', callEventSchema, (data, user) =>
      mutateCall(io, socket, data, user, 'accept'));
    bindEvent(socket, 'call:reject', callEventSchema, (data, user) =>
      mutateCall(io, socket, data, user, 'reject'));
    bindEvent(socket, 'call:end', callEventSchema, (data, user) =>
      mutateCall(io, socket, data, user, 'end'));
    bindEvent(socket, 'call:resume', callEventSchema, (data, user) =>
      handleResume(io, socket, data, user));
    bindEvent(socket, 'call:join', joinSchema, (data) => handleJoin(io, socket, data));
    bindEvent(socket, 'call:offer', offerSchema, (data) =>
      relaySignal(socket, 'call:offer', data));
    bindEvent(socket, 'call:answer', answerSchema, (data) =>
      relaySignal(socket, 'call:answer', data));
    bindEvent(socket, 'call:ice-candidate', iceSchema, (data) =>
      relaySignal(socket, 'call:ice-candidate', data));

    socket.onAny((event) => {
      const supported = [
        'call:initiate',
        'call:accept',
        'call:reject',
        'call:end',
        'call:resume',
        'call:join',
        'call:offer',
        'call:answer',
        'call:ice-candidate',
      ];
      if (!supported.includes(event)) {
        socket.emit('call:error', {
          event,
          success: false,
          code: 'UNSUPPORTED_SIGNAL_EVENT',
          message: 'This signaling event is not supported',
        });
      }
    });

    socket.on('disconnect', () => {
      void onDisconnect(io, socket).catch((error) => {
        logger.error('Telemedicine socket disconnect cleanup failed', {
          userId: socket.data.user?.sub,
          errorMessage: error.message,
        });
      });
    });
  });

  const sweep = setInterval(() => {
    void expireOldRingingCalls(io).catch((error) => {
      logger.error('Unanswered call timeout sweep failed', { errorMessage: error.message });
    });
  }, 5_000);
  sweep.unref?.();
  io.on('close', () => {
    clearInterval(sweep);
    for (const timer of ringTimers.values()) clearTimeout(timer);
    for (const timer of joinTimers.values()) clearTimeout(timer);
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    ringTimers.clear();
    joinTimers.clear();
    disconnectTimers.clear();
  });
  return io;
}

module.exports = { attachTelemedicineSockets, createCallToken };
