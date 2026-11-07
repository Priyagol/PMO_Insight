import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { getStorage, isStorageConfigured } from '../config/storage';
import { ServiceUnavailableError } from '../core/errors';

/** Object storage operations used by attachments and documents. */
export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Short-lived URL that downloads the object with the original file name. */
  signedDownloadUrl(key: string, fileName: string, contentType: string): Promise<string>;
  remove(key: string): Promise<void>;
}

const DOWNLOAD_URL_TTL_SECONDS = 300;

/** RFC 6266 filename that is safe for every browser. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const s3Driver: StorageDriver = {
  async put(key, body, contentType) {
    if (!isStorageConfigured()) throw new ServiceUnavailableError('File storage is not configured');
    await getStorage().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  },
  async signedDownloadUrl(key, fileName, contentType) {
    if (!isStorageConfigured()) throw new ServiceUnavailableError('File storage is not configured');
    return getSignedUrl(
      getStorage(),
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: contentDisposition(fileName),
        ResponseContentType: contentType,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  },
  async remove(key) {
    if (!isStorageConfigured()) return;
    await getStorage().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  },
};

let driver: StorageDriver = s3Driver;

export function storage(): StorageDriver {
  return driver;
}

/** Test hook: swap in an in-memory driver. Pass null to restore S3. */
export function setStorageDriver(next: StorageDriver | null): void {
  driver = next ?? s3Driver;
}
