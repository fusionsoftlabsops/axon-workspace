import { describe, it, expect } from 'vitest';

import { GET } from './route';
import { buildOpenApiDocument, OPENAPI_VERSION } from '@/lib/openapi/spec';

const EXPECTED_PATHS = [
  '/api/v1/openapi.json',
  '/api/v1/tasks',
  '/api/v1/skills',
  '/api/v1/projects/{slug}/tasks',
  '/api/v1/projects/{slug}/tasks/{taskNumber}',
  '/api/v1/projects/{slug}/tasks/{taskNumber}/comments',
  '/api/v1/projects/{slug}/tasks/{taskNumber}/qa-review',
  '/api/v1/projects/{slug}/tasks/{taskNumber}/qa-decision',
  '/api/v1/projects/{slug}/tasks/{taskNumber}/ai/commit-message',
  '/api/v1/projects/{slug}/tasks/{taskNumber}/ai/pr-description',
  '/api/v1/projects/{slug}/brain/memories',
  '/api/v1/projects/{slug}/brain/memories/{id}',
  '/api/v1/projects/{slug}/brain/memories/{id}/cite',
  '/api/v1/projects/{slug}/brain/memories/{id}/publish',
  '/api/v1/projects/{slug}/brain/recall',
  '/api/v1/projects/{slug}/brain/extract',
  '/api/v1/projects/{slug}/brain/pull',
  '/api/v1/projects/{slug}/files',
  '/api/v1/projects/{slug}/files/{id}',
  '/api/v1/projects/{slug}/files/{id}/context',
  '/api/v1/projects/{slug}/plan',
  '/api/v1/projects/{slug}/plan/attachments',
  '/api/v1/projects/{slug}/repo/tree',
  '/api/v1/projects/{slug}/repo/grep',
  '/api/v1/projects/{slug}/repo/preview',
  '/api/v1/projects/{slug}/stories/drafts',
  '/api/v1/projects/{slug}/stories/drafts/{id}',
  '/api/v1/projects/{slug}/stories/drafts/{id}/publish',
  '/api/v1/projects/{slug}/bugs',
];

describe('buildOpenApiDocument', () => {
  const doc = buildOpenApiDocument();

  it('is OpenAPI 3.1.x', () => {
    expect(doc.openapi).toBe(OPENAPI_VERSION);
    expect(doc.openapi).toMatch(/^3\.1\.\d+$/);
  });

  it('is serializable to and from JSON', () => {
    const round = JSON.parse(JSON.stringify(doc));
    expect(round.info.title).toBe('Axon API');
    expect(round.info.version).toBe('v1');
  });

  it('declares the bearer + session security schemes', () => {
    const schemes = doc.components.securitySchemes as Record<string, { type: string; scheme?: string }>;
    expect(schemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(schemes.sessionAuth).toMatchObject({ type: 'apiKey', in: 'cookie' });
  });

  it('lists exactly the expected /api/v1 paths', () => {
    const paths = Object.keys(doc.paths).sort();
    expect(paths).toEqual([...EXPECTED_PATHS].sort());
  });

  it('accepts a custom server base url', () => {
    const custom = buildOpenApiDocument('https://axon.example.com');
    expect(custom.servers[0]!.url).toBe('https://axon.example.com');
  });

  it('attaches required scopes to scoped operations', () => {
    const createTask = (doc.paths['/api/v1/projects/{slug}/tasks'] as Record<string, Record<string, unknown>>)
      .post;
    expect(createTask['x-required-scopes']).toEqual(['tasks:write']);
    expect(createTask.security).toEqual([{ bearerAuth: [] }]);

    const bugs = (doc.paths['/api/v1/projects/{slug}/bugs'] as Record<string, Record<string, unknown>>).post;
    expect(bugs['x-required-scopes']).toEqual(['bugs:write']);
  });

  it('marks repo endpoints as accepting either auth', () => {
    const tree = (doc.paths['/api/v1/projects/{slug}/repo/tree'] as Record<string, Record<string, unknown>>)
      .get;
    expect(tree.security).toEqual([{ bearerAuth: [] }, { sessionAuth: [] }]);
    expect(tree['x-required-scopes']).toEqual(['repo:read']);
  });

  it('marks session-only file endpoints with the session scheme', () => {
    const upload = (doc.paths['/api/v1/projects/{slug}/files'] as Record<string, Record<string, unknown>>)
      .post;
    expect(upload.security).toEqual([{ sessionAuth: [] }]);
    expect(upload['x-required-scopes']).toBeUndefined();
  });

  it('references defined components from every $ref', () => {
    const json = JSON.stringify(doc);
    const refs = [...json.matchAll(/"\$ref":"(#\/[^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const segments = ref.replace(/^#\//, '').split('/');
      let node: unknown = doc;
      for (const seg of segments) {
        expect(node, `resolving ${ref} at "${seg}"`).toBeTypeOf('object');
        node = (node as Record<string, unknown>)[seg];
      }
      expect(node, `unresolved $ref ${ref}`).toBeDefined();
    }
  });
});

describe('GET /api/v1/openapi.json', () => {
  it('returns 200 with the OpenAPI document and cache headers', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const body = await res.json();
    expect(body.openapi).toMatch(/^3\.1\.\d+$/);
    expect(body.paths['/api/v1/openapi.json']).toBeDefined();
    expect(Object.keys(body.paths).length).toBe(EXPECTED_PATHS.length);
  });
});
