-- Skills package: org-wide registry of best-practice commands/guidelines.

-- CreateEnum
CREATE TYPE "SkillCategory" AS ENUM ('TESTING', 'QUALITY', 'WORKFLOW', 'ARCHITECTURE', 'GIT', 'OTHER');
CREATE TYPE "SkillKind" AS ENUM ('COMMAND', 'GUIDELINE');
CREATE TYPE "SkillStatus" AS ENUM ('PENDING', 'APPROVED', 'DEPRECATED');

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "SkillCategory" NOT NULL DEFAULT 'OTHER',
    "kind" "SkillKind" NOT NULL DEFAULT 'COMMAND',
    "body" TEXT NOT NULL,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "status" "SkillStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "tags" TEXT[],
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Skill_slug_key" ON "Skill"("slug");
CREATE INDEX "Skill_status_category_idx" ON "Skill"("status", "category");
CREATE INDEX "Skill_official_idx" ON "Skill"("official");

-- Seed the official best-practice skills (idempotent).
INSERT INTO "Skill" ("id","slug","name","description","category","kind","body","official","status","version","tags","authorId","createdAt","updatedAt") VALUES
(gen_random_uuid()::text, 'cerrar-hu', 'Cerrar HU', 'Cierra una historia de usuario y la entrega a QA (llama a submit_qa_review).', 'WORKFLOW', 'COMMAND',
'# /cerrar-hu <numeroHU>

Cierra una historia de usuario y la entrega a QA.

## Pasos
1. `get_task` para leer la HU (titulo, descripcion, criterios de aceptacion).
2. Verifica cada criterio de aceptacion contra lo implementado (cumplido / no cumplido).
3. Genera pruebas de QA sugeridas (camino feliz, bordes, validaciones y errores) con title/steps/expected.
4. Arma el listado de tareas ejecutadas durante el desarrollo.
5. Llama a `submit_qa_review` con { projectSlug, taskNumber, criteria, suggestedTests, executedTasks, notes }.
   Esto publica un comentario de resumen y mueve la HU a Verificacion.

## Salida
La HU pasa a Verificacion y aparece en la vista QA de Axon para revision.',
 true, 'APPROVED', 1, ARRAY['qa','workflow'], NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

(gen_random_uuid()::text, 'e2e-tests', 'Pruebas E2E obligatorias', 'Todo proyecto debe tener pruebas end-to-end de sus flujos criticos.', 'TESTING', 'GUIDELINE',
'# Pruebas E2E obligatorias

Todo proyecto debe tener pruebas end-to-end que cubran los flujos criticos de usuario.

## Reglas
- Cada feature con UI o API publica tiene al menos un caso E2E de su camino feliz.
- Usa el runner del stack presente en el repo (Playwright / Cypress / supertest).
- Los E2E corren en CI antes de mergear a main.

## Al implementar una HU
- Agrega o actualiza el E2E del flujo afectado.
- No marques la HU como lista si su flujo critico no tiene cobertura E2E.',
 true, 'APPROVED', 1, ARRAY['testing','e2e'], NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

(gen_random_uuid()::text, 'unit-coverage-90', 'Cobertura unitaria minima 90%', 'Mantener un gate de cobertura de tests unitarios mayor o igual a 90%.', 'TESTING', 'GUIDELINE',
'# Cobertura unitaria minima 90%

El proyecto mantiene un gate de cobertura de tests unitarios mayor o igual a 90%.

## Reglas
- Cada modulo/servicio nuevo o modificado viene con sus tests unitarios.
- Mide con el coverage del runner (jest --coverage / vitest run --coverage).
- Si bajas la cobertura por debajo de 90%, agrega tests antes de pushear.

## Al terminar
Corre la cobertura y confirma que el total y los archivos tocados quedan mayor o igual a 90%.',
 true, 'APPROVED', 1, ARRAY['testing','coverage'], NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

(gen_random_uuid()::text, 'pre-push', 'Lint y tests antes del push', 'Corre lint y tests unitarios y solo pushea si todo pasa en verde.', 'GIT', 'COMMAND',
'# /pre-push

Antes de cada push al repositorio, corre lint y tests unitarios y solo pushea si todo pasa.

## Pasos
1. Ejecuta el lint del repo (npm run lint / pnpm lint). Corrige errores.
2. Ejecuta los tests unitarios (npm test / vitest run). Deben pasar todos.
3. Opcional: verifica la cobertura mayor o igual a 90%.
4. Solo si 1 y 2 pasan en verde, ejecuta git push.

## Recomendado
Instala un git hook pre-push que corra estos pasos automaticamente.',
 true, 'APPROVED', 1, ARRAY['git','ci'], NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

(gen_random_uuid()::text, 'solid-principles', 'Principios SOLID', 'Aplica SOLID durante el desarrollo para codigo mantenible y testeable.', 'ARCHITECTURE', 'GUIDELINE',
'# Principios SOLID

Aplica SOLID durante el desarrollo para mantener el codigo mantenible y testeable.

- S — Responsabilidad unica: cada clase/modulo hace una sola cosa.
- O — Abierto/Cerrado: extiende por composicion, no modificando lo existente.
- L — Sustitucion de Liskov: los subtipos respetan el contrato de su base.
- I — Segregacion de interfaces: interfaces pequenas y especificas, no gordas.
- D — Inversion de dependencias: depende de puertos/abstracciones, no de implementaciones concretas.

## Al codificar
- Inyecta dependencias por interfaz (puertos), no instancies concretas dentro.
- Extrae responsabilidades cuando una clase crece o mezcla concerns.',
 true, 'APPROVED', 1, ARRAY['architecture','solid'], NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
