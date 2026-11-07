import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

let client: S3Client | null = null;

export function isStorageConfigured(): boolean {
  return Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY);
}

/** S3-compatible client (SeaweedFS in development; any S3-compatible store on-prem). File upload/download services build on this in Phase 3. */
export function getStorage(): S3Client {
  if (!isStorageConfigured()) {
    throw new Error(
      'Object storage is not configured (S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY)',
    );
  }
  client ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! },
  });
  return client;
}

export async function pingStorage(): Promise<void> {
  await getStorage().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
}

/**
 * Development convenience: creates the bucket if it does not exist. Production buckets are
 * provisioned by operations, and the API's production credentials should not be able to create them.
 */
export async function ensureBucket(): Promise<'exists' | 'created'> {
  try {
    await pingStorage();
    return 'exists';
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw err;
    await getStorage().send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
    return 'created';
  }
}
