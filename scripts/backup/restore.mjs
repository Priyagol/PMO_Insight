#!/usr/bin/env node
// Restores a backup made by backup.mjs.
//
//   RESTORE_URI=<target connection string> RESTORE_CONFIRM=<target database name> \
//     node --env-file=server/.env scripts/backup/restore.mjs <backup folder> [--files]
//
// The target database is replaced (collections are dropped first), so the target database name must be
// typed again in RESTORE_CONFIRM. Restore into a scratch database first and check it before touching a
// live one. --files uploads the backed-up files into S3_BUCKET (existing objects with the same key are
// overwritten).
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { dbNameOf, mongoTool, redact, s3Client, serverUriOf, sha256 } from './lib.mjs';

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: restore.mjs <backup folder> [--files]');
  process.exit(2);
}
const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
const archive = path.join(folder, manifest.mongo.file);
const target = process.env.RESTORE_URI;
if (!target) {
  console.error('Set RESTORE_URI to the target connection string (including the database name).');
  process.exit(2);
}
const targetDb = dbNameOf(target);
if (process.env.RESTORE_CONFIRM !== targetDb) {
  console.error(
    `This replaces database "${targetDb}". Set RESTORE_CONFIRM=${targetDb} to continue.`,
  );
  process.exit(2);
}
if ((await sha256(archive)) !== manifest.mongo.sha256) {
  console.error('Checksum mismatch: the archive is damaged or was changed. Nothing restored.');
  process.exit(1);
}

console.log(
  `Restoring "${manifest.database}" (${manifest.createdAt}) into "${targetDb}" at ${redact(target)}`,
);
// Connect without a database path: with one, mongorestore filters the archive to that name before
// applying --nsFrom/--nsTo and silently restores nothing.
const log = await mongoTool(
  'mongorestore',
  {
    uri: serverUriOf(target),
    rest: [
      '--archive',
      '--gzip',
      '--drop',
      `--nsFrom=${manifest.database}.*`,
      `--nsTo=${targetDb}.*`,
    ],
  },
  { stdin: createReadStream(archive) },
);
const restored = Number(log.match(/(\d+) document\(s\) restored successfully/)?.[1] ?? NaN);
const failed = Number(log.match(/(\d+) document\(s\) failed to restore/)?.[1] ?? 0);
const expected = manifest.mongo.collections.reduce((n, c) => n + c.documents, 0);
if (restored !== expected || failed > 0) {
  console.error(
    `Restore incomplete: ${restored} of ${expected} documents restored, ${failed} failed.`,
  );
  process.exit(1);
}
console.log(
  `Database restored: ${restored} documents in ${manifest.mongo.collections.length} collections.`,
);

if (process.argv.includes('--files')) {
  if (!manifest.files) {
    console.error('This backup has no files.');
    process.exit(1);
  }
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await s3Client();
  const base = path.join(folder, 'files');
  let n = 0;
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const key = path.relative(base, p).split(path.sep).join('/');
        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            Body: createReadStream(p),
            ContentLength: (await stat(p)).size,
          }),
        );
        n++;
      }
    }
  };
  await walk(base);
  console.log(`${n} files uploaded to ${process.env.S3_BUCKET}.`);
}
