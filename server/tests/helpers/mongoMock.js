function matches(document, query = {}) {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some((condition) => matches(document, condition));
    const actual = document[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      return Object.entries(expected).every(([operator, value]) => {
        if (operator === '$ne') return actual !== value;
        if (operator === '$gt') return actual > value;
        if (operator === '$gte') return actual >= value;
        if (operator === '$lt') return actual < value;
        if (operator === '$lte') return actual <= value;
        if (operator === '$in') return value.includes(actual);
        return false;
      });
    }
    return actual === expected || (expected === null && actual === undefined);
  });
}

function createMemoryMongo() {
  const documents = new Map();
  const collection = (name) => {
    if (!documents.has(name)) documents.set(name, []);
    const rows = documents.get(name);
    return {
      findOne: async (query) => rows.find((row) => matches(row, query)) || null,
      insertOne: async (document) => {
        rows.push(structuredClone(document));
        return { insertedId: document.id };
      },
      updateOne: async (query, update, options = {}) => {
        let row = rows.find((item) => matches(item, query));
        const inserted = !row && options.upsert;
        if (!row && inserted) {
          row = {};
          for (const [key, value] of Object.entries(query)) {
            if (!key.startsWith('$') && (value === null || typeof value !== 'object')) row[key] = value;
          }
          rows.push(row);
        }
        if (!row) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        Object.assign(row, structuredClone(update.$set || {}));
        for (const key of Object.keys(update.$unset || {})) delete row[key];
        if (inserted) Object.assign(row, structuredClone(update.$setOnInsert || {}));
        for (const [key, value] of Object.entries(update.$inc || {})) {
          row[key] = Number(row[key] || 0) + value;
        }
        return { matchedCount: inserted ? 0 : 1, modifiedCount: 1, upsertedCount: inserted ? 1 : 0 };
      },
      updateMany: async (query, update) => {
        const found = rows.filter((row) => matches(row, query));
        for (const row of found) {
          Object.assign(row, structuredClone(update.$set || {}));
          for (const key of Object.keys(update.$unset || {})) delete row[key];
          for (const [key, value] of Object.entries(update.$inc || {})) {
            row[key] = Number(row[key] || 0) + value;
          }
        }
        return { matchedCount: found.length, modifiedCount: found.length };
      },
      deleteMany: async (query) => {
        const remaining = rows.filter((row) => !matches(row, query));
        const deletedCount = rows.length - remaining.length;
        documents.set(name, remaining);
        return { deletedCount };
      },
      find: (query) => {
        let found = rows.filter((row) => matches(row, query));
        const cursor = {
          sort: (sort) => {
            const [[field, direction]] = Object.entries(sort);
            found = found.sort((left, right) =>
              (left[field] > right[field] ? 1 : left[field] < right[field] ? -1 : 0) * direction);
            return cursor;
          },
          skip: (count) => {
            found = found.slice(count);
            return cursor;
          },
          limit: (count) => {
            found = found.slice(0, count);
            return cursor;
          },
          toArray: async () => found.map((row) => structuredClone(row)),
        };
        return cursor;
      },
      countDocuments: async (query) => rows.filter((row) => matches(row, query)).length,
      createIndex: async () => 'mock-index',
    };
  };
  return {
    getDb: async () => ({ collection, databaseName: 'aarogya_test' }),
    reset: () => documents.clear(),
    insert: (name, document) => {
      if (!documents.has(name)) documents.set(name, []);
      documents.get(name).push(structuredClone(document));
    },
    all: (name) => structuredClone(documents.get(name) || []),
  };
}

const mongo = createMemoryMongo();

module.exports = {
  ...mongo,
  matches,
};
