const { v5: uuidv5 } = require('uuid');
const {
  FACILITY_NAMES,
  HOSPITAL_NAMES,
  PRIMARY_CARE_NAMES,
  CHC_NAME,
} = require('../facilities/catalog');

const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const facilityId = (collection, name) =>
  uuidv5(`aarogya-facility:${collection}:${name}`, NAMESPACE);
const facilityCode = (prefix, name) =>
  `${prefix}-${name.replace(/[^A-Z0-9]+/gi, '-').replace(/^-|-$/g, '').toUpperCase()}`;

async function seedFacilityDirectory(db, now = new Date()) {
  const legacyHospitalIds = Array.from({ length: 4 }, (_value, index) =>
    uuidv5(`aarogya-demo:hospital:${index}`, NAMESPACE));
  const legacyPhcIds = Array.from({ length: 35 }, (_value, index) =>
    uuidv5(`aarogya-demo:phc:${index}`, NAMESPACE));

  await Promise.all([
    db.collection('hospitals').updateMany(
      { id: { $in: legacyHospitalIds } },
      { $set: { is_active: false, updated_at: now } },
    ),
    db.collection('phcs').updateMany(
      { id: { $in: legacyPhcIds } },
      { $set: { is_active: false, updated_at: now } },
    ),
    // Reconcile the legacy spelling with the supplied canonical facility name before seeding.
    db.collection('phcs').updateOne(
      { name: 'CHC -MUNCHINGIPUTTU' },
      { $set: { name: CHC_NAME, facility_type: 'chc', updated_at: now } },
    ),
    db.collection('facility_locations').updateOne(
      { name_key: 'chc -munchingiputtu' },
      { $set: { name: CHC_NAME, name_key: CHC_NAME.toLocaleLowerCase('en'), facility_type: 'chc', updated_at: now } },
    ),
  ]);

  const seedCollection = async (collectionName, names, additionalFields = () => ({})) => {
    const collection = db.collection(collectionName);
    const codeField = collectionName === 'hospitals' ? 'hospital_code' : 'phc_code';
    const codePrefix = collectionName === 'hospitals' ? 'HOSP' : 'FAC';
    for (const name of names) {
      const targetCode = facilityCode(codePrefix, name);
      const existing = await collection.findOne({
        $or: [{ name }, { [codeField]: targetCode }],
      });
      const query = existing?.id ? { id: existing.id } : { name };
      await collection.updateOne(
        query,
        {
          $set: {
            name,
            [codeField]: existing?.[codeField] || targetCode,
            is_active: true,
            updated_at: now,
            ...additionalFields(name),
          },
          $setOnInsert: {
            id: facilityId(collectionName, name),
            created_at: now,
          },
        },
        { upsert: true },
      );
    }
    const records = await collection.find({ name: { $in: names }, is_active: true }).toArray();
    const recordsByName = new Map(records.map((record) => [record.name, record]));
    return names.flatMap((name) => {
      const record = recordsByName.get(name);
      return record ? [record] : [];
    });
  };

  const [hospitals, primaryCareFacilities] = await Promise.all([
    seedCollection('hospitals', HOSPITAL_NAMES),
    seedCollection('phcs', PRIMARY_CARE_NAMES, (name) => ({
      facility_type: name === CHC_NAME ? 'chc' : 'phc',
    })),
  ]);

  const locations = db.collection('facility_locations');
  for (const name of FACILITY_NAMES) {
    const nameKey = name.toLocaleLowerCase('en');
    await locations.updateOne(
      { name_key: nameKey },
      {
        $setOnInsert: {
          id: facilityId('facility_locations', name),
          name,
          name_key: nameKey,
          area: '',
          facility_type: 'unverified',
          verification_status: 'unverified',
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    );
  }

  return { hospitals, primaryCareFacilities, locations: FACILITY_NAMES.length };
}

module.exports = { seedFacilityDirectory };
