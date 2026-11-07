# Backup and Restore Runbook

Backups hold confidential company data (projects, people, documents). Store them only on encrypted storage that just the operations team can reach, and never commit them (`backups/` is gitignored).

## What is backed up

| Data                                                | How                                                             | Where                                         |
| --------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| MongoDB database (every collection and its indexes) | `mongodump --archive --gzip`                                    | `BACKUP_DIR/<UTC timestamp>/mongo.archive.gz` |
| Stored files (attachments, documents, exports)      | Every object in `S3_BUCKET` is copied                           | `BACKUP_DIR/<UTC timestamp>/files/`           |
| Manifest                                            | Collection document counts, file counts, SHA-256 of the archive | `BACKUP_DIR/<UTC timestamp>/manifest.json`    |

Redis holds only queues, rate-limit counters and caches. It is not backed up: after a restore, scheduled jobs are recreated when the worker starts.

## Taking a backup

```bash
# Uses MONGO_URI and S3_* from the server environment file
npm run backup                          # database + files
npm run backup -- --no-files            # database only
BACKUP_DIR=/secure/backups BACKUP_RETENTION_DAYS=30 npm run backup
```

- If `mongodump` is not installed, the script runs it from the official `mongo:7` Docker image (`MONGO_TOOLS_IMAGE` overrides the image).
- Backup folders older than `BACKUP_RETENTION_DAYS` (default 30) are deleted at the end of each run. Only folders the script itself names are removed.
- **Schedule:** run nightly from a dedicated host (for example cron at 01:30 IST), then copy the folder to a second location (another region or offline media).
- **Managed hosting:** when MongoDB Atlas is used, also turn on Atlas continuous backup, and turn on versioning for the storage bucket. This script is the portable copy that does not depend on the provider.

## Restoring

The restore replaces the target database: its collections are dropped first. As a safeguard, the target database name must be typed again in `RESTORE_CONFIRM`, and the archive's checksum is verified before anything is changed.

1. **Restore into a scratch database first and check it.**
   ```bash
   RESTORE_URI='mongodb://.../arihant_restore_check?...' RESTORE_CONFIRM=arihant_restore_check \
     npm run restore -- backups/2026-11-06T16-46-54-955Z
   ```
   The script compares the number of documents restored with the manifest, and exits with an error if they differ.
2. Sign in to a staging copy pointed at the scratch database and spot-check recent projects, tasks and approvals.
3. **Restore the live database.**
   - Stop the API and the worker so nothing writes during the restore.
   - Run the same command with the live database name.
   - Add `--files` to upload the stored files back to `S3_BUCKET`. Objects with the same key are overwritten; others are left alone.
4. Start the API and the worker. Check `GET /api/v1/ready`, then sign in.
5. Record the restore in the operations log: who ran it, which backup was used, and why.

People who signed in after the backup must sign in again, because refresh tokens are restored as they were at backup time.

## Verified

Run on 2026-11-06 against the local development stack (synthetic DEV data only):

- **Backup:** 42 collections, 796 documents and 8 stored files, in 2.4 s.
- **Restore guard:** the restore refused to run without `RESTORE_CONFIRM`.
- **Restore into a scratch database:** 796 of 796 documents restored. The per-collection count comparison with the source found 0 differences, and the 12 task indexes were restored. The scratch database was dropped afterwards.
- **Not yet exercised:** restoring files (`--files`), because it writes into the live development bucket.

Schedule a restore drill every quarter, and after any change to the data model.
