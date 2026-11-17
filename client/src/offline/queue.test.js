import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueRegistration,
  getQueuedRegistrations,
  removeQueuedRegistration,
  syncQueuedRegistrations,
} from './queue.js';

const databaseName = 'aarogya-offline-queue';
const payload = {
  client_uuid: 'b6fcfbdd-a13f-4598-8ce9-0f65a3393d84',
  full_name: 'Synthetic Offline Patient',
};

function deleteQueueDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Offline queue database is still open'));
  });
}

describe('offline patient registration queue', () => {
  beforeEach(async () => {
    await deleteQueueDatabase();
  });

  it('stores pending data and removes it after successful synchronization', async () => {
    await enqueueRegistration(payload);
    const api = { post: vi.fn().mockResolvedValue({ data: { success: true } }) };
    expect(await getQueuedRegistrations()).toHaveLength(1);

    await expect(syncQueuedRegistrations(api)).resolves.toEqual({
      synced: 1,
      pending: 0,
      failed: 0,
      conflicts: 0,
      credentials: [],
    });
    expect(api.post).toHaveBeenCalledWith('/patients', payload);
    expect(await getQueuedRegistrations()).toEqual([]);
  });

  it('keeps credential-pending rows without storing the one-time password locally', async () => {
    await enqueueRegistration(payload);
    const api = {
      post: vi.fn().mockResolvedValue({
        data: {
          data: {
            patient: { id: 'synthetic-id', patient_code: 'AD-2026-000001' },
            temporary_password: 'OneTimePass1',
          },
        },
      }),
    };

    const result = await syncQueuedRegistrations(api);
    expect(result.credentials).toEqual([{
      client_uuid: payload.client_uuid,
      patient: { id: 'synthetic-id', patient_code: 'AD-2026-000001' },
      temporary_password: 'OneTimePass1',
    }]);
    const [queued] = await getQueuedRegistrations();
    expect(queued.status).toBe('credentials_ready');
    expect(queued).not.toHaveProperty('temporary_password');
    await removeQueuedRegistration(payload.client_uuid);
  });

  it('retains duplicate conflicts for staff review instead of retrying automatically', async () => {
    await enqueueRegistration(payload);
    const api = {
      post: vi.fn().mockRejectedValue({
        response: {
          status: 409,
          data: { code: 'PATIENT_DUPLICATE', errors: [{ candidates: [{ id: 'synthetic-id' }] }] },
        },
      }),
    };

    await expect(syncQueuedRegistrations(api)).resolves.toMatchObject({ conflicts: 1 });
    await expect(syncQueuedRegistrations(api)).resolves.toMatchObject({ conflicts: 1 });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(await getQueuedRegistrations()).toMatchObject([
      { status: 'conflict', candidates: [{ id: 'synthetic-id' }] },
    ]);
  });
});
