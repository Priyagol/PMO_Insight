// Shared helpers for backup.mjs and restore.mjs (Node 22+, no extra dependencies besides the S3 SDK).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const MONGO_TOOLS_IMAGE = process.env.MONGO_TOOLS_IMAGE ?? 'mongo:7';

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Run with --env-file pointing at the server environment file.`);
    process.exit(2);
  }
  return v;
}

/** Database name from a MongoDB connection string. */
export function dbNameOf(uri) {
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  if (!m) throw new Error('The connection string must include a database name');
  return decodeURIComponent(m[1]);
}

/** The same connection string without the database path (namespaces are then chosen by flags). */
export const serverUriOf = (uri) => uri.replace(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^?]*/, '$1/');

/** Never print credentials. */
export const redact = (uri) => uri.replace(/\/\/[^@/]+@/, '//***@');

const hasLocal = (bin) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;

/**
 * Runs a MongoDB database tool (mongodump / mongorestore). Uses the local binary when installed,
 * otherwise the official mongo image through Docker (localhost is rewritten to the Docker host).
 * In Docker mode the URI goes through the environment so it does not show in host process listings;
 * a locally installed binary receives it as --uri (run backups from a dedicated, locked-down host).
 */
export function mongoTool(bin, args, { stdin, stdout } = {}) {
  const uri = args.uri;
  const rest = args.rest;
  let cmd;
  let argv;
  let env = { ...process.env, MONGO_TOOL_URI: uri };
  if (hasLocal(bin)) {
    cmd = bin;
    argv = [`--uri=${uri}`, ...rest];
    env = process.env;
  } else {
    const dockerUri = uri.replace(
      /\/\/(localhost|127\.0\.0\.1)([:/])/g,
      '//host.docker.internal$2',
    );
    cmd = 'docker';
    argv = [
      'run',
      '--rm',
      '-i',
      '--add-host=host.docker.internal:host-gateway',
      '-e',
      'MONGO_TOOL_URI',
      MONGO_TOOLS_IMAGE,
      'sh',
      '-c',
      `exec ${bin} --uri="$MONGO_TOOL_URI" ${rest.map((a) => `'${a}'`).join(' ')}`,
    ];
    env = { ...process.env, MONGO_TOOL_URI: dockerUri };
  }
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, {
      env,
      stdio: [stdin ? 'pipe' : 'ignore', stdout ? 'pipe' : 'inherit', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    if (stdin) stdin.pipe(p.stdin);
    if (stdout) p.stdout.pipe(stdout);
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(err) : reject(new Error(`${bin} exited ${code}: ${err.slice(-800)}`)),
    );
  });
}

export async function sha256(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

export async function s3Client() {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY'),
      secretAccessKey: requireEnv('S3_SECRET_KEY'),
    },
  });
}
