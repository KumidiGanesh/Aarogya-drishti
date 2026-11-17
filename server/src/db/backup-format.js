const { BSON } = require('mongodb');
const { EJSON } = BSON;

function serializeRecord(record) {
  return `${EJSON.stringify(record, { relaxed: false })}\n`;
}

function parseRecord(line) {
  return EJSON.parse(line, { relaxed: false });
}

module.exports = { serializeRecord, parseRecord };
