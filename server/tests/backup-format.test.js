const { Long, ObjectId } = require('mongodb');
const { parseRecord, serializeRecord } = require('../src/db/backup-format');

describe('MongoDB backup record format', () => {
  it('preserves BSON dates, object ids, and 64-bit integers', () => {
    const record = {
      created_at: new Date('2025-01-02T03:04:05.000Z'),
      object_id: new ObjectId('507f1f77bcf86cd799439011'),
      sequence: Long.fromString('9007199254740993'),
    };

    const restored = parseRecord(serializeRecord(record));

    expect(restored.created_at).toEqual(record.created_at);
    expect(restored.created_at).toBeInstanceOf(Date);
    expect(restored.object_id).toEqual(record.object_id);
    expect(restored.object_id).toBeInstanceOf(ObjectId);
    expect(restored.sequence).toEqual(record.sequence);
    expect(Long.isLong(restored.sequence)).toBe(true);
  });
});
