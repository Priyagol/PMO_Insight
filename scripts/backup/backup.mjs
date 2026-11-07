#!/usr/bin/env node
// Backs up the MongoDB database (gzip archive) and, optionally, every stored file from the bucket.
//
//   node --env-file=server/.env scripts/backup/backup.mjs [--no-files]
//
// Env: MONGO_URI (required), BACKUP_DIR (default ./backups), BACKUP_RETENTION_DAYS (default 30),
//      S3_* (for files). Output: BACKUP_DIR/<UTC timestamp>/{mongo.archive.gz, files/, manifest.json}.
// Backups contain confidential company data: keep BACKUP_DIR on encrypted storage with restricted access.
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { dbNameOf, mongoTool, redact, requireEnv, s3Client, sha256 } from './lib.mjs';

const uri = requireEnv('MONGO_URI');
const root = path.resolve(process.env.BACKUP_DIR ?? 'backups');
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
const withFiles = !process.argv.includes('--no-files');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(root, stamp);
await mkdir(dir, { recursive: true });

const started = Date.now();
const db = dbNameOf(uri);
console.log(`Backing up database "${db}" from ${redact(uri)} to ${dir}`);
const archive = path.join(dir, 'mongo.archive.gz');
const out = createWriteStream(archive);
const log = await mongoTool(
  'mongodump',
  { uri, rest: ['--archive', '--gzip', `--db=${db}`] },
  { stdout: out },
);
if (!out.writableFinished) await once(out, 'finish');
const collections = [...log.matchAll(/done dumping \S+?\.(\S+) \((\d+) documents?\)/g)].map(
  (m) => ({
    name: m[1],
    documents: Number(m[2]),
  }),
);

const manifest = {
  createdAt: new Date().toISOString(),
  database: db,
  mongo: {
    file: 'mongo.archive.gz',
    bytes: (await stat(archive)).size,
    sha256: await sha256(archive),
    collections,
  },
  files: null,
};

if (withFiles && process.env.S3_BUCKET) {
  const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await s3Client();
  const bucket = process.env.S3_BUCKET;
  let token;
  let count = 0;
  let bytes = 0;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const obj of page.Contents ?? []) {
      const target = path.join(dir, 'files', ...obj.Key.split('/'));
      if (!target.startsWith(path.join(dir, 'files')))
        throw new Error(`Unsafe object key: ${obj.Key}`);
      await mkdir(path.dirname(target), { recursive: true });
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
      await pipeline(res.Body, createWriteStream(target));
      count++;
      bytes += obj.Size ?? 0;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  manifest.files = { bucket, objects: count, bytes };
}

await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(
  `Done in ${((Date.now() - started) / 1000).toFixed(1)} s: ${collections.length} collections, ` +
    `${collections.reduce((n, c) => n + c.documents, 0)} documents` +
    (manifest.files ? `, ${manifest.files.objects} files` : ''),
);

// Retention: remove backup folders older than the retention window (only folders this script names).
const cutoff = Date.now() - retentionDays * 86_400_000;
for (const name of await readdir(root)) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m || name === stamp) continue;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  if (t < cutoff) {
    await rm(path.join(root, name), { recursive: true, force: true });
    console.log(`Removed expired backup ${name}`);
  }
}
