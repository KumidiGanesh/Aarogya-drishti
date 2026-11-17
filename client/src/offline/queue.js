const DATABASE_NAME = 'aarogya-offline-queue';
const DATABASE_VERSION = 2;
const STORE_NAME = 'patient-registrations';
const SCREENING_STORE_NAME = 'oral-screenings';
const MAX_ATTEMPTS = 6;

function openQueue() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('Offline storage is unavailable in this browser'));
  }
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'client_uuid' });
      }
      if (!request.result.objectStoreNames.contains(SCREENING_STORE_NAME)) {
        request.result.createObjectStore(SCREENING_STORE_NAME, { keyPath: 'client_uuid' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open offline storage'));
  });
}

function withStore(mode, callback) {
  return openQueue().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let result;
        try {
          result = callback(store);
        } catch (error) {
          database.close();
          reject(error);
          return;
        }
        transaction.oncomplete = () => {
          database.close();
          resolve(result?.result);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error || new Error('Offline storage transaction failed'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error || new Error('Offline storage transaction was aborted'));
        };
      }),
  );
}

export function enqueueRegistration(payload) {
  return withStore('readwrite', (store) =>
    store.put({
      client_uuid: payload.client_uuid,
      payload,
      status: 'pending',
      attempts: 0,
      created_at: new Date().toISOString(),
      next_retry_at: null,
      last_error: null,
      candidates: [],
    }),
  );
}

export async function getQueuedRegistrations() {
  const rows = await withStore('readonly', (store) => store.getAll());
  return (rows || []).sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function updateQueuedRegistration(clientUuid, updates) {
  return openQueue().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(clientUuid);
        request.onsuccess = () => {
          if (!request.result) {
            reject(new Error('Offline registration was not found'));
            transaction.abort();
            return;
          }
          store.put({ ...request.result, ...updates });
        };
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error || new Error('Could not update offline registration'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error || new Error('Offline registration update was aborted'));
        };
      }),
  );
}

export function removeQueuedRegistration(clientUuid) {
  return withStore('readwrite', (store) => store.delete(clientUuid));
}

export async function syncQueuedRegistrations(api, { force = false } = {}) {
  const queue = await getQueuedRegistrations();
  const summary = { synced: 0, pending: 0, failed: 0, conflicts: 0, credentials: [] };
  for (const item of queue) {
    if (item.status === 'conflict' || item.status === 'failed') {
      if (!force) {
        summary[item.status === 'conflict' ? 'conflicts' : 'failed'] += 1;
        continue;
      }
    }
    if (item.next_retry_at && !force && new Date(item.next_retry_at) > new Date()) {
      summary.pending += 1;
      continue;
    }
    if (item.status === 'credentials_ready' && !force) {
      summary.pending += 1;
      continue;
    }
    try {
      const response = await api.post('/patients', item.payload);
      const temporaryPassword = response.data?.data?.temporary_password;
      if (temporaryPassword) {
        summary.credentials.push({
          client_uuid: item.client_uuid,
          patient: response.data.data.patient,
          temporary_password: temporaryPassword,
        });
        await updateQueuedRegistration(item.client_uuid, {
          status: 'credentials_ready',
          attempts: 0,
          next_retry_at: null,
          last_error: null,
        });
      } else {
        await removeQueuedRegistration(item.client_uuid);
      }
      summary.synced += 1;
    } catch (error) {
      const code = error.response?.data?.code;
      if (error.response?.status === 409 && code === 'PATIENT_DUPLICATE') {
        await updateQueuedRegistration(item.client_uuid, {
          status: 'conflict',
          candidates: error.response.data.errors?.[0]?.candidates || [],
          last_error: code,
          next_retry_at: null,
        });
        summary.conflicts += 1;
        continue;
      }
      if (
        error.response?.status === 409
        && ['PATIENT_ACCOUNT_EXISTS', 'PATIENT_ACCOUNT_ALREADY_LINKED'].includes(code)
      ) {
        await updateQueuedRegistration(item.client_uuid, {
          status: 'failed',
          last_error: code,
          next_retry_at: null,
        });
        summary.failed += 1;
        continue;
      }
      const attempts = item.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      const delaySeconds = Math.min(60 * 60, 2 ** attempts * 5);
      await updateQueuedRegistration(item.client_uuid, {
        status,
        attempts,
        last_error: code || 'SYNC_FAILED',
        next_retry_at:
          status === 'pending' ? new Date(Date.now() + delaySeconds * 1000).toISOString() : null,
      });
      summary[status === 'pending' ? 'pending' : 'failed'] += 1;
    }
  }
  return summary;
}
