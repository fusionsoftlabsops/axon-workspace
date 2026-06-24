/**
 * Object storage (MinIO / S3) for the per-project file store.
 *
 * Bytes live in MinIO; Postgres only keeps metadata (see ProjectFile). Axon
 * talks to MinIO over the internal `fusion` network and proxies up/downloads
 * so the per-member access check is preserved (no public bucket exposure).
 *
 * Layout — one bucket (S3_BUCKET, default `axon`) with a per-project main
 * folder, organized by type and date:
 *   projects/<slug>/.keep                              (folder marker)
 *   projects/<slug>/<category>/<YYYY-MM>/<fileId>-<name>
 */
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { FileCategory } from '@prisma/client';
import { env } from '@/lib/env';

let client: S3Client | null = null;
let bucketReady = false;

/** Returns the configured client, or throws a clear error if storage isn't set up. */
function s3(): { client: S3Client; bucket: string } {
  const e = env();
  if (!e.S3_ENDPOINT || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      'Object storage no está configurado (faltan S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY)',
    );
  }
  if (!client) {
    client = new S3Client({
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return { client, bucket: e.S3_BUCKET };
}

/** Whether storage credentials are present (used to fail fast with 503). */
export function isStorageConfigured(): boolean {
  const e = env();
  return Boolean(e.S3_ENDPOINT && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY);
}

/** Create the bucket if missing. Idempotent; cached after the first success. */
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const { client: c, bucket } = s3();
  try {
    await c.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    try {
      await c.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (err) {
      // A concurrent create or "already owned by you" is fine.
      const name = (err as { name?: string })?.name ?? '';
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(name)) throw err;
    }
  }
  bucketReady = true;
}

/** The project's main folder prefix. */
export function projectPrefix(slug: string): string {
  return `projects/${slug}/`;
}

/** Materialize the project's main folder with a `.keep` marker so it shows up
 *  in the MinIO console even before any file is uploaded. Best-effort caller. */
export async function ensureProjectFolder(slug: string): Promise<void> {
  await ensureBucket();
  const { client: c, bucket } = s3();
  await c.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${projectPrefix(slug)}.keep`,
      Body: new Uint8Array(0),
      ContentType: 'application/x-empty',
    }),
  );
}

function sanitizeName(name: string): string {
  return (name || 'archivo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'archivo';
}

/** Build the object key: organized by project / type / month. */
export function buildKey(
  slug: string,
  category: FileCategory,
  fileId: string,
  name: string,
  date: Date,
): string {
  const ym = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${projectPrefix(slug)}${category.toLowerCase()}/${ym}/${fileId}-${sanitizeName(name)}`;
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  await ensureBucket();
  const { client: c, bucket } = s3();
  await c.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

/** Fetch an object's bytes (proxied back to the member through the API route). */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const { client: c, bucket } = s3();
  const res = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) throw new Error('Respuesta de storage vacía');
  return body.transformToByteArray();
}

export async function deleteObject(key: string): Promise<void> {
  const { client: c, bucket } = s3();
  await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
