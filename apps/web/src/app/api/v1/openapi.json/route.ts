/**
 * GET /api/v1/openapi.json
 *
 * Public, unauthenticated API discovery endpoint. Returns the OpenAPI 3.1
 * document describing the `/api/v1` surface so that AI agents and the Axon
 * MCP server can discover the API without reading source.
 *
 * Discovery is intentionally open (no auth). The document only describes the
 * API shape; every described operation still enforces its own auth.
 */
import { NextResponse } from 'next/server';
import { buildOpenApiDocument } from '@/lib/openapi/spec';

export const runtime = 'nodejs';

export function GET() {
  const doc = buildOpenApiDocument();
  return NextResponse.json(doc, {
    status: 200,
    headers: {
      // Cacheable: the spec is static per deploy. Allow CDN + clients to cache
      // for an hour and serve stale while revalidating.
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
