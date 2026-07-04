/**
 * Resuelve el modelo LLM configurado del AGENTE que está actuando (por su
 * userId de servicio + proyecto). Es el puente entre la config de la card /
 * preset de equipo y los generadores server-side: lo que se ve en la UI es lo
 * que corre. Defensivo: cualquier fallo → null (el generador usa su default).
 */
import { prisma } from '@/lib/db';

export async function agentModelFor(projectId: string, userId: string): Promise<string | null> {
  try {
    const agent = await prisma.agent.findFirst({
      where: { projectId, userId },
      select: { llmModel: true },
    });
    return agent?.llmModel ?? null;
  } catch {
    return null;
  }
}
