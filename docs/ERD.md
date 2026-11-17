# Entity relationship overview

This conceptual diagram shows principal MongoDB collection relationships; reference/catalog collections and audit fields are omitted for readability. MongoDB connection and index definitions are maintained in [`server/src/db/mongo.js`](../server/src/db/mongo.js).

```mermaid
erDiagram
  USERS ||--o| PATIENTS : "linked profile"
  USERS ||--o| DOCTORS : "linked profile"
  USERS ||--o| HEALTH_WORKERS : "linked profile"
  USERS ||--o| SPECIALISTS : "linked profile"
  USERS ||--o{ REFRESH_SESSIONS : authenticates
  USERS ||--o{ NOTIFICATIONS : receives
  USERS ||--o{ USER_SETTINGS : configures
  PATIENTS ||--o{ PATIENT_CONSENTS : grants
  PATIENTS ||--o{ RESEARCH_CONSENTS : grants_or_withdraws
  USERS ||--o{ RESEARCH_CONSENTS : records
  PATIENTS ||--o{ ORAL_SCREENINGS : screened
  ORAL_SCREENINGS ||--o{ SCREENING_SYMPTOMS : records
  ORAL_SCREENINGS ||--o{ SCREENING_IMAGES : contains
  ORAL_SCREENINGS ||--o| AI_SCREENING_RESULTS : evaluates
  ORAL_SCREENINGS ||--o{ CLINICAL_REVIEWS : reviewed
  ORAL_SCREENINGS ||--o| SCREENING_DOCTOR_REQUESTS : requests_review
  PATIENTS ||--o{ SCREENING_DOCTOR_REQUESTS : requests
  USERS ||--o{ SCREENING_DOCTOR_REQUESTS : assigned_doctor
  PATIENTS ||--o{ APPOINTMENTS : books
  DOCTORS ||--o{ APPOINTMENTS : attends
  APPOINTMENTS ||--o| CONSULTATIONS : enables
  CONSULTATIONS ||--o{ CONSULTATION_NOTES : documents
  PATIENTS ||--o{ REFERRALS : referred
  ORAL_SCREENINGS ||--o{ REFERRALS : supports
  REFERRALS ||--o{ REFERRAL_EVENTS : tracks
  REFERRALS ||--o{ REFERRAL_DOCUMENTS : attaches
  PATIENTS ||--o{ MEDICINES : prescribed
  MEDICINES ||--o{ MEDICINE_REMINDERS : scheduled
  MEDICINE_REMINDERS ||--o{ MEDICATION_LOGS : records
  PATIENTS ||--o{ EMERGENCY_CONTACTS : selects
  PATIENTS ||--o{ EMERGENCY_REQUESTS : requests
  USERS ||--o{ AUDIT_LOGS : acts
```

Patient photographs and referral files are represented by opaque storage keys, encryption metadata, and content hashes. The corresponding bytes live in the private storage adapter and are not exposed as public URLs. See [`SECURITY.md`](./SECURITY.md) for access and key-handling details.

`screening_doctor_requests` links one patient-owned screening to its selected doctor and records its `submitted`, `under_review`, or `responded` state and timestamps. Its unique screening index prevents duplicate requests; doctor/status and patient/date indexes support the isolated inboxes. Starting a request requires active data-collection and photo consent and an uploaded image. A request grants only the selected doctor access to that patient for the requested screening. Clinical reviews remain in `clinical_reviews`, with optional follow-up recommendation and date fields.

`research_consents` is a separate append-only participant-consent event collection. Each event references the patient and user, records the purpose, consent version, language, status, sequence, grant timestamp, and (for withdrawal events) withdrawal timestamp. A unique patient/sequence index makes concurrent consent state changes conflict instead of silently reordering the history. Withdrawal blocks matching `research_dataset_items`; it does not delete or update clinical records.

Sealed `research_datasets` store `manifest_version`, `manifest_algorithm`, `manifest_hash`, and `manifest_item_count`. The hash covers stable, de-identified manifest fields and expert annotation provenance; reads verify the digest before returning any export. The unique `research_dataset_items.id` index and unique dataset/image index protect item identity and enrollment idempotency. Curation tests use the opt-in `npm run test:research-mongo --workspace server` only with an isolated, loopback MongoDB database named `aarogya_drishti_research_test_*`; test fixtures are not governance approval.
