const DATABASE_NAME = 'aarogya-offline-queue';
const DATABASE_VERSION = 2;
const STORE_NAME = 'oral-screenings';
const MAX_ATTEMPTS = 6;

function openQueue() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('Offline storage is unavailable in this browser'));
  }
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('patient-registrations')) {
        request.result.createObjectStore('patient-registrations', { keyPath: 'client_uuid' });
      }
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'client_uuid' });
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

export async function enqueueScreening(payload, screeningId, files, site) {
  const item = {
    client_uuid: payload.client_uuid,
    payload,
    screening_id: screeningId || null,
    files: files.map((file) => ({ blob: file, name: file.name, type: file.type })),
    site,
    status: 'pending',
    attempts: 0,
    created_at: new Date().toISOString(),
    next_retry_at: null,
    last_error: null,
  };
  await withStore('readwrite', (store) => store.put(item));
}

export async function getQueuedScreenings() {
  const rows = await withStore('readonly', (store) => store.getAll());
  return (rows || []).sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export async function updateQueuedScreening(clientUuid, updates) {
  const database = await openQueue();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(clientUuid);
    request.onsuccess = () => {
      if (!request.result) {
        transaction.abort();
        reject(new Error('Queued screening was not found'));
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
      reject(transaction.error || new Error('Could not update queued screening'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error('Queued screening update was aborted'));
    };
  });
}

export function removeQueuedScreening(clientUuid) {
  return withStore('readwrite', (store) => store.delete(clientUuid));
}

export async function syncQueuedScreenings(api, { force = false } = {}) {
  const queue = await getQueuedScreenings();
  const summary = { synced: 0, pending: 0, failed: 0, conflicts: 0 };
  for (const item of queue) {
    if (['conflict', 'failed'].includes(item.status)) {
      if (!force) {
        summary[item.status === 'conflict' ? 'conflicts' : 'failed'] += 1;
        continue;
      }
    }
    if (item.next_retry_at && !force && new Date(item.next_retry_at) > new Date()) {
      summary.pending += 1;
      continue;
    }
    try {
      let screeningId = item.screening_id;
      if (!screeningId) {
        const { data } = await api.post('/screenings', item.payload);
        screeningId = data.data.screening.id;
        await updateQueuedScreening(item.client_uuid, { screening_id: screeningId });
      }
      if (item.files?.length) {
        const formData = new FormData();
        formData.append('site', item.site || 'other');
        item.files.forEach(({ blob, name }) => formData.append('images', blob, name));
        await api.post(`/screenings/${screeningId}/upload-image`, formData);
      }
      await removeQueuedScreening(item.client_uuid);
      summary.synced += 1;
    } catch (error) {
      const code = error.response?.data?.code || 'SYNC_FAILED';
      if (error.response?.status === 409) {
        await updateQueuedScreening(item.client_uuid, {
          status: 'conflict',
          last_error: code,
          next_retry_at: null,
        });
        summary.conflicts += 1;
        continue;
      }
      const attempts = item.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      const delaySeconds = Math.min(60 * 60, 2 ** attempts * 5);
      await updateQueuedScreening(item.client_uuid, {
        status,
        attempts,
        last_error: code,
        next_retry_at:
          status === 'pending' ? new Date(Date.now() + delaySeconds * 1000).toISOString() : null,
      });
      summary[status === 'pending' ? 'pending' : 'failed'] += 1;
    }
  }
  return summary;
}
