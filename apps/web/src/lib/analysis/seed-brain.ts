/**
 * Seed the project brain with knowledge derived from the code analysis. Creates
 * PROJECT-scoped memories tagged `source:code-analysis`; re-running replaces the
 * previous seeds (idempotent) so the brain reflects the latest graph.
 */
import { prisma } from '@/lib/db';
import type { GodNode } from './describe';

export const CODE_ANALYSIS_TAG = 'source:code-analysis';

export async function seedBrainFromAnalysis(params: {
  projectId: string;
  authorId: string;
  summary: string;
  godNodes: GodNode[];
}): Promise<number> {
  const { projectId, authorId, summary, godNodes } = params;

  // Idempotent: drop prior code-analysis seeds before re-seeding.
  await prisma.brainMemory.deleteMany({
    where: { projectId, scope: 'PROJECT', tags: { has: CODE_ANALYSIS_TAG } },
  });

  const memories: { type: 'PATTERN' | 'GLOSSARY'; title: string; body: string }[] = [
    {
      type: 'PATTERN',
      title: 'Arquitectura del código (mapa graphify)',
      body:
        `Resumen del código real del proyecto, generado automáticamente a partir del ` +
        `grafo de conocimiento (graphify) de sus repos:\n\n${summary}`,
    },
  ];

  if (godNodes.length > 0) {
    memories.push({
      type: 'GLOSSARY',
      title: 'Conceptos centrales del código',
      body:
        'Conceptos más conectados del código (god nodes del grafo de conocimiento), ' +
        'por número de relaciones:\n\n' +
        godNodes.map((g) => `- **${g.label}** — ${g.degree} conexiones`).join('\n'),
    });
  }

  if (memories.length === 0) return 0;

  await prisma.brainMemory.createMany({
    data: memories.map((m) => ({
      projectId,
      scope: 'PROJECT' as const,
      ownerUserId: null,
      authorId,
      type: m.type,
      title: m.title,
      body: m.body,
      tags: [CODE_ANALYSIS_TAG],
    })),
  });

  return memories.length;
}
