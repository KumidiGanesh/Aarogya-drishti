# Backup and recovery

## Scope and schedule

The backup scripts cover the MongoDB database and the private local storage directory. Run them once daily and after database changes. An example production cron entry, run as the restricted deployment account:

```cron
0 2 * * * cd /srv/aarogya-drishti && RETENTION_DAYS=30 ./scripts/backup.sh >> /var/log/aarogya-backup.log 2>&1
```

The database snapshot is a canonical MongoDB Extended JSON Lines export encrypted with AES-256-GCM; BSON values such as dates and 64-bit integers are preserved. The encrypted private-storage snapshot archives `STORAGE_LOCAL_PATH`. Both artifacts use independent random salt and IV and derive the key from `BACKUP_PASSPHRASE`. The object files are themselves application-encrypted. Keep the passphrase in a secrets manager, never beside the backup artifacts. The script retains matching artifact types for 30 days by default; copy selected monthly backups to a separate, access-controlled location before they expire.

The local-storage script is not an S3 bucket snapshot tool. In production with `STORAGE_DRIVER=s3`, enable bucket versioning/replication and provider-side encrypted backups, or replace the storage snapshot step with the provider's approved backup/export operation. Verify that recovery preserves application ciphertext and object keys; never make the bucket public.

## Restore drill

1. Provision an isolated MongoDB recovery database and a private empty storage directory. Use a separate recovery host or network.
2. Retrieve both encrypted backup files and obtain `BACKUP_PASSPHRASE` from the independent secrets manager.
3. Configure `MONGODB_URI` and `MONGODB_DATABASE` to target the recovery database, and `STORAGE_LOCAL_PATH` to the recovery storage directory.
4. Run `RESTORE_CONFIRM=replace ./scripts/restore.sh <database-backup.aesgcm> <storage.tar.aesgcm>`. The database restore replaces every collection in the configured database. Never point it at production or a database containing data that must be preserved.
5. Run `npm run db:check`, verify a private image is reachable through authenticated application access, verify a direct static storage path returns 404, and check recent audit records.
6. Record the restore date, artifact identifiers, recovery point, elapsed time, verification outcome, and operator. Remove the isolated recovery environment only after verification and retention approval.

`server/tests/backup-storage.test.js` exercises encrypted private-storage snapshot round-trip and rejects a tampered authentication tag. The MongoDB backup/restore scripts must be tested with a separate disposable database before production; operators must complete and record the first isolated drill before production.
