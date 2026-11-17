# Security

## Scope and threat model

Aarogya Drishti is a synthetic-data demonstration platform, not a clinical product. Primary threats include account takeover, broken role/ownership checks, exposure of health data or image objects, compromised provider credentials, malicious uploads, token replay, database privilege escalation, unsafe exports, and loss or tampering of backups. Controls are defense-in-depth: validated inputs, authorization on API routes, private encrypted storage, HTTPS, audit events, least-privilege database credentials, and controlled backup recovery. The system has not undergone an independent penetration test or regulatory/security certification.

Do not enter real patient information. Do not claim clinical validation, diagnostic performance, or an institutional endorsement. AI output is preliminary only and must not diagnose, confirm cancer, or determine cancer stage. The questionnaire-only demo must retain its `DEMO AI OUTPUT - NOT FOR CLINICAL USE` label; Gemini reports must be labelled preliminary and not a diagnosis, with the professional-evaluation warning.

## Authentication and authorization

- Access tokens default to 15 minutes; refresh tokens are stored hashed server-side, rotated on refresh, and revoked on logout, reuse detection, password change, or administrative reset.
- Refresh cookies use `httpOnly`, `secure`, `sameSite=strict`, and the `/api/auth` path. Do not weaken these attributes in production.
- Password hashes use bcrypt cost 12. Admin-created temporary passwords require a password change.
- API authorization must enforce roles, ownership, PHC/village assignment, and specialist-referral scope. Frontend route guards and hidden navigation are UX only, not security boundaries.
- All patient data collection and photo uploads require the corresponding active consent. SOS coordinates are stored/shared only after explicit location consent.
- Patient accounts are created only by authorized staff. A bcrypt-hashed temporary password is shown in the staff response once, is not persisted in the offline queue, and requires a change at first sign-in. Offline registrations require manual synchronization and handoff; retries can rotate an unclaimed temporary password without storing it in plaintext.
- When configured, chatbot text is sent to Google Gemini using a server-only API key. The interface warns users not to submit identifiers or private health records, and the server blocks common phone, email, Aadhaar-like, and demo patient-ID patterns. This filtering cannot guarantee detection of all personal information. The chatbot accepts text only. Separately, the screening route may send encrypted-at-rest, metadata-stripped oral image bytes to Gemini only after active, separately audited `ai_processing` consent. Questionnaire answers are not sent to the vision provider. Do not include names, IDs, address, free-text notes, or unrelated health history in the Gemini prompt. Provider use is subject to Google data-processing terms; this integration does not assert provider-side deletion.
- `helmet` sets CSP and related security headers. CORS is restricted to `CORS_ORIGINS`. Global and endpoint-specific rate limits, Zod request validation, content-type checks, upload size limits, and magic-byte checks are applied.
- In production, serve only through a trusted TLS reverse proxy. The API rejects non-HTTPS requests except its health endpoint, enables HSTS, and trusts forwarded protocol only when `TRUST_PROXY` is configured and network access to the API is restricted to that proxy.

## Patient data, uploads, and offline behavior

Patients can access only their linked records. Staff access is limited to role and assignment scope. Patient, user, and appointment deletion is soft deletion. Aadhaar is not mandatory and is not required by the user interface or registration flow.

Screening images accept JPEG/PNG/WebP only, validate file signatures and quality, enforce the size/count limits, re-encode via Sharp to remove EXIF/GPS, and encrypt with AES-256-GCM using a fresh 96-bit IV per object. Referral documents are also encrypted. Database rows contain opaque storage keys, cipher metadata, and hashes. Storage directories and buckets are private; no static route or public URL exposes image/document objects. Authenticated image/document reads verify authorization, disable caching, and audit sensitive views.

The PWA caches only its app shell and synthetic catalogs. Patient API responses and images must not be added to service-worker caches. Offline queues are for synthetic demonstration data; do not use them with real patient information.

## Database and audit

Production MongoDB connections must use TLS and authenticated, least-privilege application credentials scoped to the application database. The application does not accept query operators from user input; request filters are validated and translated into fixed MongoDB query structures. Audit records are append-only by application convention; production DB roles should deny updates/deletes to the audit collection where operationally supported.

Authentication, sensitive record access, image/document viewing, exports, admin mutations, consent changes, and system settings are audit logged. Audit entries must not contain passwords, tokens, full medical content, or precise location when not consented.

## Key management and rotation

Store JWT, database, video, notification, storage-encryption, and backup secrets in a managed secret store. Use separate keys per environment and least-privilege provider credentials. Keep a stable `STORAGE_ENCRYPTION_KEY_ID` and retain old keys securely until every object encrypted under them is re-encrypted and verified.

For storage-key rotation: provision a new 32-byte key and key ID; deploy a keyring-capable migration/re-encryption process that can decrypt old objects and encrypt each with a unique fresh IV; verify plaintext hashes and authenticated reads; atomically update metadata to the new key ID; keep the old key in restricted escrow through the recovery-retention window; then destroy it under dual control. Do not simply replace the active key in `.env`, because existing objects would become unreadable.

Rotate JWT signing secrets by supporting current and next verification keys during a controlled overlap, invalidating active refresh sessions as appropriate, then removing the former key. Rotate provider/database credentials using overlapping credentials where supported. Rotate the backup passphrase only after creating and verifying new backups; retain access to older backup keys until their retention expires.

## Retention and incident response

Define a deployment-specific retention schedule for patient/demo records, audit logs, encrypted objects, exports, and backups; apply legal and organizational retention rules before real-world use. Deletion or deactivation should not bypass required medical-record retention. Keep backups encrypted and separate from the production host.

For suspected compromise: isolate affected services/credentials without destroying evidence; preserve relevant audit and platform logs; revoke sessions and rotate exposed keys; restrict storage/database access; determine the impacted records and time window; notify the responsible security/privacy contacts and follow applicable legal notification requirements; restore from a known-good backup only after containment; document timeline, scope, corrective actions, and verification. Never publish sensitive patient or credential details in tickets.

## Backup and recovery

Use `./scripts/backup.sh` for daily encrypted MongoDB and private local-storage snapshots. Keep the passphrase separate from artifacts, retain daily backups for 30 days, and keep selected monthly copies in a separate encrypted location. S3 deployments need private bucket versioning/replication or an approved encrypted provider snapshot process. Follow the isolated restore drill in [BACKUP.md](./BACKUP.md) and explicitly confirm destructive database replacement.
