import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const send = vi.fn();
  const env: Record<string, unknown> = {};
  return { send, env };
});

vi.mock('@/lib/env', () => ({ env: () => h.env }));

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = h.send;
    constructor(public cfg: unknown) {}
  }
  class Cmd {
    constructor(public input: unknown) {}
  }
  return {
    S3Client,
    HeadBucketCommand: class extends Cmd {},
    CreateBucketCommand: class extends Cmd {},
    PutObjectCommand: class extends Cmd {},
    GetObjectCommand: class extends Cmd {},
    DeleteObjectCommand: class extends Cmd {},
  };
});

const CONFIGURED = {
  S3_ENDPOINT: 'http://minio:9000',
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: true,
  S3_BUCKET: 'axon',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
};

beforeEach(() => {
  vi.resetModules();
  h.send.mockReset().mockResolvedValue({});
  for (const k of Object.keys(h.env)) delete h.env[k];
});

function configure() {
  Object.assign(h.env, CONFIGURED);
}

describe('isStorageConfigured', () => {
  it('is false when credentials are missing', async () => {
    h.env.S3_REGION = 'us-east-1';
    h.env.S3_BUCKET = 'axon';
    const { isStorageConfigured } = await import('./storage');
    expect(isStorageConfigured()).toBe(false);
  });

  it('is true when all credentials are present', async () => {
    configure();
    const { isStorageConfigured } = await import('./storage');
    expect(isStorageConfigured()).toBe(true);
  });
});

describe('s3 client guard', () => {
  it('throws a clear error when storage is not configured', async () => {
    h.env.S3_BUCKET = 'axon';
    const { ensureBucket } = await import('./storage');
    await expect(ensureBucket()).rejects.toThrow(/no está configurado/);
  });
});

describe('projectPrefix / buildKey', () => {
  it('builds the project prefix', async () => {
    configure();
    const { projectPrefix } = await import('./storage');
    expect(projectPrefix('my-proj')).toBe('projects/my-proj/');
  });

  it('builds an organized key with sanitized name and month', async () => {
    configure();
    const { buildKey } = await import('./storage');
    const key = buildKey('slug', 'IMAGE', 'file123', 'Photo Réport!.png', new Date(Date.UTC(2026, 0, 5)));
    expect(key).toBe('projects/slug/image/2026-01/file123-Photo-Report-.png');
  });

  it('falls back to "archivo" for an empty/stripped name', async () => {
    configure();
    const { buildKey } = await import('./storage');
    const key = buildKey('slug', 'OTHER', 'fid', '***', new Date(Date.UTC(2026, 10, 1)));
    expect(key).toBe('projects/slug/other/2026-11/fid-archivo');
  });
});

describe('ensureBucket', () => {
  it('does nothing extra when the bucket already exists (HeadBucket ok)', async () => {
    configure();
    const { ensureBucket } = await import('./storage');
    await ensureBucket();
    expect(h.send).toHaveBeenCalledTimes(1); // only HeadBucket
    // cached: second call is a no-op
    await ensureBucket();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('creates the bucket when HeadBucket fails', async () => {
    configure();
    h.send.mockRejectedValueOnce(new Error('not found')); // HeadBucket
    h.send.mockResolvedValueOnce({}); // CreateBucket
    const { ensureBucket } = await import('./storage');
    await ensureBucket();
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it('swallows BucketAlreadyOwnedByYou on create', async () => {
    configure();
    h.send.mockRejectedValueOnce(new Error('head fail'));
    h.send.mockRejectedValueOnce(Object.assign(new Error('owned'), { name: 'BucketAlreadyOwnedByYou' }));
    const { ensureBucket } = await import('./storage');
    await expect(ensureBucket()).resolves.toBeUndefined();
  });

  it('rethrows an unexpected create error', async () => {
    configure();
    h.send.mockRejectedValueOnce(new Error('head fail'));
    h.send.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'AccessDenied' }));
    const { ensureBucket } = await import('./storage');
    await expect(ensureBucket()).rejects.toThrow(/boom/);
  });

  it('rethrows a create error with no name property', async () => {
    configure();
    h.send.mockRejectedValueOnce(new Error('head fail'));
    h.send.mockRejectedValueOnce('plain string error');
    const { ensureBucket } = await import('./storage');
    await expect(ensureBucket()).rejects.toBe('plain string error');
  });
});

describe('object operations', () => {
  it('ensureProjectFolder writes the .keep marker', async () => {
    configure();
    const { ensureProjectFolder } = await import('./storage');
    await ensureProjectFolder('slug');
    // HeadBucket + PutObject
    expect(h.send).toHaveBeenCalledTimes(2);
    const putInput = (h.send.mock.calls[1][0] as { input: { Key: string } }).input;
    expect(putInput.Key).toBe('projects/slug/.keep');
  });

  it('putObject ensures the bucket and puts the object', async () => {
    configure();
    const { putObject } = await import('./storage');
    await putObject('some/key', Buffer.from('data'), 'text/plain');
    expect(h.send).toHaveBeenCalledTimes(2);
    const putInput = (h.send.mock.calls[1][0] as { input: { Key: string; ContentType: string } }).input;
    expect(putInput.Key).toBe('some/key');
    expect(putInput.ContentType).toBe('text/plain');
  });

  it('getObjectBytes returns the transformed bytes', async () => {
    configure();
    const bytes = new Uint8Array([1, 2, 3]);
    h.send.mockResolvedValueOnce({ Body: { transformToByteArray: () => Promise.resolve(bytes) } });
    const { getObjectBytes } = await import('./storage');
    expect(await getObjectBytes('k')).toBe(bytes);
  });

  it('getObjectBytes throws on an empty body', async () => {
    configure();
    h.send.mockResolvedValueOnce({ Body: undefined });
    const { getObjectBytes } = await import('./storage');
    await expect(getObjectBytes('k')).rejects.toThrow(/vacía/);
  });

  it('deleteObject sends a delete command', async () => {
    configure();
    const { deleteObject } = await import('./storage');
    await deleteObject('k');
    const input = (h.send.mock.calls[0][0] as { input: { Key: string } }).input;
    expect(input.Key).toBe('k');
  });
});
