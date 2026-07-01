'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { createProjectAgentTokenAction, type ProjectAgentSetup } from '@/lib/actions/fusion-code';

export interface DevelopHU {
  number: number;
  title: string;
  state: string;
  done: boolean;
  sprint: string | null;
}

const card: React.CSSProperties = {
  padding: '1rem 1.25rem',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  marginBottom: '1.25rem',
};
const stepNum: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 999,
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg)',
  fontSize: '0.75rem',
  fontWeight: 700,
  marginRight: 8,
};
const mono: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 4,
  padding: '0.05rem 0.3rem',
  fontSize: '0.82em',
};
const lead: React.CSSProperties = { margin: '0 0 0.5rem', color: 'var(--color-fg-muted)', fontSize: '0.9rem', lineHeight: 1.55 };

/** A copyable command/snippet. */
function CopyRow({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', margin: '0.4rem 0' }}>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: '0.55rem 0.7rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          overflowX: 'auto',
        }}
      >
        {value}
      </pre>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        style={{
          padding: '0.4rem 0.75rem',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--color-fg)',
          whiteSpace: 'nowrap',
        }}
      >
        {copied ? t('¡Copiado!', 'Copied!') : (label ?? t('Copiar', 'Copy'))}
      </button>
    </div>
  );
}

/** A non-copyable, read-only example / expected-output block. */
function Sample({ children }: { children: ReactNode }) {
  return (
    <pre
      style={{
        margin: '0.4rem 0',
        padding: '0.55rem 0.7rem',
        background: 'var(--color-bg)',
        border: '1px dashed var(--color-border)',
        borderRadius: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.76rem',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        color: 'var(--color-fg-muted)',
        overflowX: 'auto',
      }}
    >
      {children}
    </pre>
  );
}

export function DevelopClient({
  slug,
  canGenerate,
  fusionBase,
  mcpUrl,
  hus,
}: {
  slug: string;
  canGenerate: boolean;
  fusionBase: string | null;
  mcpUrl: string;
  hus: DevelopHU[];
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<ProjectAgentSetup | null>(null);
  const [os, setOs] = useState<'sh' | 'ps1'>('sh');

  const base = fusionBase ? fusionBase.replace(/\/$/, '') : null;
  const installOneLiner = base
    ? os === 'sh'
      ? `curl -fsSL ${base}/api/coding-tools/install.sh | sh`
      : `irm ${base}/api/coding-tools/install.ps1 | iex`
    : null;

  const envLine = setup ? `AXON_API_TOKEN=${setup.plainToken}` : '';
  const axonConfig = `{ "projectSlug": "${slug}" }`;
  const mcpSnippet = setup
    ? JSON.stringify(
        { mcpServers: { axon: { httpUrl: mcpUrl, headers: { Authorization: 'Bearer ${AXON_API_TOKEN}' } } } },
        null,
        2,
      )
    : '';
  const firstHu = hus.find((h) => !h.done) ?? hus[0];
  const exampleN = firstHu?.number ?? 1;

  // ---- Reference data (rendered as tables at the bottom of the guide) ----
  const commands: Array<{ cmd: string; ex: string; desc: string }> = [
    { cmd: '/task', ex: `/task ${exampleN}`, desc: t('Baja una HU (título, descripción, criterios) + memorias del cerebro a .axon/current-task.md.', 'Pulls a story (title, description, criteria) + brain memories into .axon/current-task.md.') },
    { cmd: '/cerrar-hu', ex: `/cerrar-hu ${exampleN}`, desc: t('Cierra la HU: verifica criterios, genera pruebas de QA, lista tareas ejecutadas y la mueve a Verificación (QA).', 'Closes the story: checks criteria, generates QA tests, lists executed tasks and moves it to Verification (QA).') },
    { cmd: '/skills', ex: '/skills sync', desc: t('Sincroniza el paquete de skills del equipo a ~/.qwen (o contribuí uno con /skills contribute).', "Syncs the team's skills package into ~/.qwen (or contribute one with /skills contribute).") },
    { cmd: '/sync', ex: '/sync', desc: t('Trae lo último del cerebro; con /sync done publica tus aprendizajes al equipo.', 'Pulls the latest brain; with /sync done it publishes your learnings to the team.') },
    { cmd: '/plan', ex: '/plan', desc: t('Ejecuta un plan (de Opus) paso a paso y verifica al final.', 'Executes an (Opus) plan step by step and verifies at the end.') },
    { cmd: '/doctor', ex: '/doctor', desc: t('Diagnostica el setup completo (qwen, extensión, tokens, modelo y salud de los MCP).', 'Diagnoses the whole setup (qwen, extension, tokens, model and MCP health).') },
  ];
  const skills: Array<{ name: string; desc: string }> = [
    { name: 'verify', desc: t('Corre tests + lint + type-check + build en contexto aislado y reporta el resultado REAL. Usalo antes de cerrar la HU.', 'Runs tests + lint + type-check + build in an isolated context and reports the REAL result. Use it before closing the story.') },
    { name: 'commit', desc: t('Genera un mensaje de commit convencional a partir del diff.', 'Generates a conventional commit message from the diff.') },
    { name: 'pr', desc: t('Redacta la descripción del Pull Request (resumen + plan de pruebas).', 'Drafts the Pull Request description (summary + test plan).') },
    { name: 'review', desc: t('Revisa el cambio buscando bugs, riesgos y mejoras antes de subirlo.', 'Reviews the change for bugs, risks and improvements before pushing.') },
    { name: 'test', desc: t('Escribe/actualiza pruebas para el código que tocaste.', 'Writes/updates tests for the code you touched.') },
    { name: 'debug', desc: t('Diagnóstico sistemático de un fallo (reproducir → aislar → arreglar).', 'Systematic diagnosis of a failure (reproduce → isolate → fix).') },
    { name: 'axon', desc: t('El ciclo completo con Axon (tarea → cerebro → cierre) como skill.', 'The full Axon loop (task → brain → close) as a skill.') },
  ];
  const mcpTools: Array<{ name: string; desc: string }> = [
    { name: 'get_task', desc: t('Lee una HU (descripción, subtareas, comentarios).', 'Reads a story (description, subtasks, comments).') },
    { name: 'list_my_tasks', desc: t('Lista las tareas asignadas a vos.', 'Lists tasks assigned to you.') },
    { name: 'recall', desc: t('Busca memorias relevantes del cerebro del proyecto.', 'Searches relevant memories in the project brain.') },
    { name: 'pull_project_brain', desc: t('Trae las novedades del cerebro central.', 'Pulls the latest from the central brain.') },
    { name: 'capture_memory / publish_memory / cite_memory', desc: t('Registra, publica y cita aprendizajes.', 'Captures, publishes and cites learnings.') },
    { name: 'update_task_status', desc: t('Mueve una tarea a otro estado del tablero.', 'Moves a task to another board state.') },
    { name: 'add_comment', desc: t('Comenta una tarea (progreso, decisiones, contexto).', 'Comments on a task (progress, decisions, context).') },
    { name: 'create_task', desc: t('Crea una tarea o subtarea descubierta durante el desarrollo.', 'Creates a task/subtask discovered during development.') },
    { name: 'submit_qa_review', desc: t('Entrega la HU a QA (lo usa /cerrar-hu).', 'Hands the story to QA (used by /cerrar-hu).') },
    { name: 'list_skills / submit_skill', desc: t('Baja el paquete de skills / contribuye uno (lo usa /skills).', 'Pulls the skills package / contributes one (used by /skills).') },
    { name: 'generate_commit_message / generate_pr_description', desc: t('Genera commit y descripción de PR (lo usan las skills commit/pr).', 'Generates commit and PR description (used by the commit/pr skills).') },
    { name: 'list_repo_tree / grep_repo', desc: t('Explora el repo del proyecto (sandbox de solo lectura).', 'Explores the project repo (read-only sandbox).') },
  ];

  function generate() {
    setError(null);
    start(async () => {
      const r = await createProjectAgentTokenAction(slug);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.data) setSetup(r.data);
    });
  }

  return (
    <div>
      {/* Overview */}
      <section style={card}>
        <p style={{ ...lead, margin: 0 }}>
          {t(
            'Fusion Code es nuestro editor de terminal (una extensión de Qwen Code) que corre sobre nuestro modelo Qwen3-Coder-Next en GPU propia. El flujo es: en Axon planeás con Opus y generás las HU; en tu máquina, Fusion Code ejecuta cada HU leyendo su contexto y el "cerebro" del proyecto por MCP. Configurás una sola vez (pasos 1–2, ~5 min) y después repetís el ciclo por cada HU (pasos 3–5).',
            'Fusion Code is our terminal editor (a Qwen Code extension) running on our own Qwen3-Coder-Next model on a dedicated GPU. The flow: in Axon you plan with Opus and generate the stories; on your machine, Fusion Code executes each story by reading its context and the project "brain" over MCP. You set it up once (steps 1–2, ~5 min) and then repeat the loop per story (steps 3–5).',
          )}
        </p>
      </section>

      {/* Workflow at a glance */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>{t('El ciclo completo, de un vistazo', 'The full loop, at a glance')}</h3>
        <Sample>
          {t(
            `CONFIGURAR (una vez)
  1. instalar Fusion Code   →  curl … | sh   (URL + token del modelo)
  2. conectar el proyecto   →  token ad_pk_ en ~/.qwen/.env  +  .axon/config.json
     /skills sync           →  baja el paquete de skills del equipo

POR CADA HU (repetir)
  3. /task <N>              →  baja la HU + criterios + cerebro a .axon/current-task.md
     (opcional) ⚙ Plan de implementación en Axon → seguilo con Qwen
     … implementás con Qwen …
  4. verify                 →  corre tests + lint + build (resultado real)
     /cerrar-hu <N>         →  verifica criterios, genera pruebas QA, → Verificación (QA)
  5. commit / pr            →  commit y PR;  /sync  publica aprendizajes al cerebro
     /task <siguiente>      →  próxima HU`,
            `SET UP (once)
  1. install Fusion Code    →  curl … | sh   (model URL + token)
  2. connect the project    →  ad_pk_ token in ~/.qwen/.env  +  .axon/config.json
     /skills sync           →  pull the team's skills package

PER STORY (repeat)
  3. /task <N>              →  pulls the story + criteria + brain into .axon/current-task.md
     (optional) ⚙ Implementation plan in Axon → have Qwen follow it
     … you implement with Qwen …
  4. verify                 →  runs tests + lint + build (real result)
     /cerrar-hu <N>         →  checks criteria, generates QA tests, → Verification (QA)
  5. commit / pr            →  commit and PR;  /sync  publishes learnings to the brain
     /task <next>           →  next story`,
          )}
        </Sample>
      </section>

      {/* Prerequisites */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>{t('Antes de empezar (requisitos)', 'Before you start (prerequisites)')}</h3>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--color-fg-muted)', fontSize: '0.88rem', lineHeight: 1.7 }}>
          <li>
            <strong>Node.js LTS</strong> ({t('v20+', 'v20+')}) —{' '}
            <a href="https://nodejs.org" target="_blank" rel="noreferrer">nodejs.org</a>.{' '}
            {t('Verificá con', 'Check with')} <code style={mono}>node -v</code>.
          </li>
          <li>{t('Una terminal (macOS/Linux: Terminal; Windows: PowerShell).', 'A terminal (macOS/Linux: Terminal; Windows: PowerShell).')}</li>
          <li>{t('El repositorio del proyecto clonado localmente (donde vas a escribir el código).', "The project's repository cloned locally (where you'll write the code).")}</li>
          <li>{t('Una cuenta en la plataforma (fusion-soft-lab) para generar el token del modelo.', 'An account on the platform (fusion-soft-lab) to generate the model token.')}</li>
        </ul>
      </section>

      {/* Step 1 — install */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>1</span>
          {t('Instalá Fusion Code', 'Install Fusion Code')}
        </h3>
        <p style={lead}>
          {t(
            'Este comando instala Qwen Code (si falta) y escribe la configuración en tu carpeta ~/.qwen (modelo, convenciones y comandos). Pegalo en tu terminal:',
            'This command installs Qwen Code (if missing) and writes the config to your ~/.qwen folder (model, conventions and commands). Paste it in your terminal:',
          )}
        </p>
        {installOneLiner ? (
          <>
            <div style={{ display: 'inline-flex', gap: 4, marginBottom: 6 }}>
              {(['sh', 'ps1'] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOs(o)}
                  style={{
                    padding: '0.2rem 0.6rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: 6,
                    background: os === o ? 'var(--color-accent)' : 'transparent',
                    color: os === o ? 'var(--color-accent-fg)' : 'var(--color-fg)',
                    fontSize: '0.75rem',
                  }}
                >
                  {o === 'sh' ? 'macOS / Linux' : 'Windows'}
                </button>
              ))}
            </div>
            <CopyRow value={installOneLiner} />
            <p style={{ ...lead, margin: '0.5rem 0 0.2rem' }}>
              {t('El instalador te va a pedir dos cosas:', 'The installer will ask you for two things:')}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--color-fg-muted)', fontSize: '0.88rem', lineHeight: 1.7 }}>
              <li>
                <strong>{t('URL del modelo', 'Model URL')}</strong> —{' '}
                {t('algo como', 'something like')} <code style={mono}>https://…fusion-soft-lab.com/v1</code>.
              </li>
              <li>
                <strong>{t('Token del modelo', 'Model token')}</strong> (<code style={mono}>fsn_…</code>) —{' '}
                {t('tu llave personal para usar el modelo (revocable y medida).', 'your personal key to use the model (revocable and metered).')}
              </li>
            </ul>
            <p style={{ ...lead, margin: '0.5rem 0 0.2rem' }}>
              {t('Ambos se generan en la plataforma:', 'Both are generated on the platform:')}{' '}
              {base ? (
                <a href={base} target="_blank" rel="noreferrer">{t('abrí la plataforma', 'open the platform')}</a>
              ) : (
                <em>fusion-soft-lab</em>
              )}{' '}
              → <strong>Coding Tools</strong> → {t('«Crear token» (copiá la URL del modelo y el token que aparecen ahí).', '"Create token" (copy the model URL and token shown there).')}
            </p>
            <p style={{ ...lead, margin: '0.5rem 0 0.2rem' }}>{t('Al terminar, verificá:', 'When done, verify:')}</p>
            <CopyRow value={'qwen'} label={t('Copiar', 'Copy')} />
            <Sample>
              {t(
                '# Deberías ver el banner:\n  FUSION CODE   Qwen3-Coder-Next - tu GPU, local y privado\n# Dentro de qwen, corré /doctor para chequear todo el setup.',
                '# You should see the banner:\n  FUSION CODE   Qwen3-Coder-Next - your GPU, local and private\n# Inside qwen, run /doctor to check the whole setup.',
              )}
            </Sample>
          </>
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-fg-muted)' }}>
            {t(
              'Instalá Fusion Code desde la página Coding Tools de la plataforma (fusion-soft-lab).',
              'Install Fusion Code from the platform Coding Tools page (fusion-soft-lab).',
            )}
          </p>
        )}
      </section>

      {/* Step 2 — connect this project to Axon */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>2</span>
          {t('Conectá este proyecto a Axon', 'Connect this project to Axon')}
        </h3>
        <p style={lead}>
          {t(
            'Esto le da permiso al editor para leer las HU y el cerebro de ESTE proyecto (solo lectura/escritura de tareas y memorias). El token se muestra una sola vez.',
            'This grants the editor permission to read the stories and brain of THIS project (read/write tasks and memories only). The token is shown once.',
          )}
        </p>
        {!setup ? (
          <button
            type="button"
            onClick={generate}
            disabled={pending || !canGenerate}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              borderRadius: 6,
              background: 'var(--color-accent)',
              color: 'var(--color-accent-fg)',
              fontWeight: 600,
              opacity: canGenerate ? 1 : 0.5,
            }}
          >
            {pending ? t('Generando…', 'Generating…') : t('Generar token del proyecto', 'Generate project token')}
          </button>
        ) : (
          <div>
            <p style={{ margin: '0 0 0.2rem', fontSize: '0.85rem', fontWeight: 700 }}>
              {t('a) Guardá el token en ', 'a) Save the token in ')}
              <code style={mono}>~/.qwen/.env</code>
            </p>
            <p style={{ ...lead, margin: '0 0 0.2rem', fontSize: '0.82rem' }}>
              {t(
                'Es un archivo en tu carpeta de usuario (crealo si no existe). En macOS/Linux: ',
                'It is a file in your home folder (create it if missing). On macOS/Linux: ',
              )}
              <code style={mono}>nano ~/.qwen/.env</code>
              {t('. En Windows: ', '. On Windows: ')}
              <code style={mono}>notepad $HOME\.qwen\.env</code>. {t('Pegá esta línea:', 'Paste this line:')}
            </p>
            <CopyRow value={envLine} />
            <p style={{ margin: '0.6rem 0 0.2rem', fontSize: '0.85rem', fontWeight: 700 }}>
              {t('b) Creá ', 'b) Create ')}
              <code style={mono}>.axon/config.json</code>
              {t(' en la RAÍZ del repo del proyecto', ' at the ROOT of the project repo')}
            </p>
            <p style={{ ...lead, margin: '0 0 0.2rem', fontSize: '0.82rem' }}>
              {t('Le dice al editor a qué proyecto de Axon pertenece este repo:', 'Tells the editor which Axon project this repo belongs to:')}
            </p>
            <CopyRow value={axonConfig} />
            <Sample>
              {t('# Estructura esperada en tu repo:\nmi-repo/\n├─ .axon/\n│  └─ config.json   ← lo que acabás de crear\n└─ … tu código …', '# Expected structure in your repo:\nmy-repo/\n├─ .axon/\n│  └─ config.json   ← what you just created\n└─ … your code …')}
            </Sample>
            <details style={{ marginTop: '0.6rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: 'var(--color-fg-muted)' }}>
                {t('¿El MCP «axon» no aparece en /doctor? Agregá esto a ', 'MCP "axon" missing in /doctor? Add this to ')}
                <code style={mono}>~/.qwen/settings.json</code>
              </summary>
              <CopyRow value={mcpSnippet} />
            </details>
            {canGenerate && (
              <button
                type="button"
                onClick={generate}
                disabled={pending}
                style={{
                  marginTop: '0.6rem',
                  padding: '0.3rem 0.7rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  background: 'transparent',
                  color: 'var(--color-fg)',
                  fontSize: '0.8rem',
                }}
              >
                {t('Regenerar token', 'Regenerate token')}
              </button>
            )}
          </div>
        )}
        {error && <p style={{ color: 'var(--color-danger)', marginTop: '0.5rem' }}>{error}</p>}
      </section>

      {/* Step 3 — pick an HU */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>3</span>
          {t('Elegí una HU y empezá a trabajarla', 'Pick a story and start working it')}
        </h3>
        <p style={lead}>
          {t('En una terminal, entrá al repo y abrí el editor:', 'In a terminal, go into the repo and open the editor:')}
        </p>
        <CopyRow value={'cd /ruta/a/tu-repo\nqwen'} />
        <p style={{ ...lead, margin: '0.5rem 0 0.2rem' }}>
          {t('Dentro de qwen, abrí una HU con ', 'Inside qwen, open a story with ')}
          <code style={mono}>/task &lt;número&gt;</code>
          {t(' — por ejemplo:', ' — for example:')}
        </p>
        <CopyRow value={`/task ${exampleN}`} />
        <p style={{ ...lead, margin: '0.5rem 0 0.2rem' }}>
          {t('Eso baja la HU (título, descripción, criterios de aceptación) + las memorias relevantes del cerebro a un archivo local ', 'That pulls the story (title, description, acceptance criteria) + relevant brain memories into a local file ')}
          <code style={mono}>.axon/current-task.md</code>
          {t(', que queda como tu contexto de trabajo:', ', which becomes your working context:')}
        </p>
        <Sample>
          {`# PROJ-${exampleN}: ${firstHu?.title ?? (t('Título de la HU', 'Story title'))}
- Estado: To Do   Prioridad: HIGH   Asignado: —
## Descripción / Criterios de aceptación
Dado … Cuando … Entonces …
## Memorias del cerebro relevantes
- **DECISION** ${t('Idea del proyecto', 'Project idea')} — …
- **GLOSSARY** ${t('Stack y repos', 'Stack & repos')} — …`}
        </Sample>
        <p style={{ ...lead, margin: '0.5rem 0 0' }}>
          {t('Ahora pedile que la implemente en lenguaje natural, p. ej.: ', 'Now ask it to implement it in plain language, e.g.: ')}
          <em>{t('«implementá la HU siguiendo los criterios de aceptación»', '"implement the story following the acceptance criteria"')}</em>.{' '}
          {t('Trae skills: ', 'It ships skills: ')}
          <code style={mono}>commit</code>, <code style={mono}>pr</code>, <code style={mono}>review</code>, <code style={mono}>test</code>, <code style={mono}>debug</code>, <code style={mono}>verify</code>{' '}
          {t('(este último corre tests/lint/build y reporta el resultado real).', '(the last one runs tests/lint/build and reports the real result).')}
        </p>

        <h4 style={{ margin: '0.9rem 0 0.3rem', fontSize: '0.9rem' }}>
          {t('Bajar el plan de implementación a Qwen', 'Pull the implementation plan into Qwen')}
        </h4>
        <p style={lead}>
          {t(
            'Para HUs con código existente, generá en Axon el ⚙ «Plan de implementación» de la HU (pestaña Plan): lee el repo real y produce un .md que se guarda en Archivos. Descargalo, ponelo en el repo y pedile a Qwen que lo siga junto con el contexto de /task:',
            'For stories with existing code, generate the ⚙ "Implementation plan" of the story in Axon (Plan tab): it reads the real repo and produces a .md saved to Files. Download it, drop it in the repo, and ask Qwen to follow it together with the /task context:',
          )}
        </p>
        <CopyRow
          value={`# 1) guardá el plan descargado en el repo, p. ej.:\n#    .axon/impl-PROJ-${exampleN}.md\n# 2) en qwen:\n/task ${exampleN}\n> seguí el plan de .axon/impl-PROJ-${exampleN}.md e implementá la HU`}
        />
        <p style={{ ...lead, margin: '0.3rem 0 0' }}>
          {t(
            'Así combinás el contexto de la HU (/task: título, descripción, criterios + cerebro) con el plan aterrizado en tu código. Para proyectos sin código aún, el plan se genera igual desde el contexto.',
            'This combines the story context (/task: title, description, criteria + brain) with the plan grounded in your code. For projects without code yet, the plan is still generated from the context.',
          )}
        </p>

        <h4 style={{ margin: '0.9rem 0 0.3rem', fontSize: '0.9rem' }}>{t('Tus HUs', 'Your stories')}</h4>
        {hus.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--color-fg-muted)' }}>
            {t('Todavía no hay HUs. Publicá un plan en ', 'No stories yet. Publish a plan in ')}
            <Link href={`/projects/${slug}/plan`}>{t('Plan', 'Plan')}</Link>.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <tbody>
              {hus.map((h) => (
                <tr key={h.number} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.4rem 0.3rem', fontFamily: 'var(--font-mono)', color: 'var(--color-fg-muted)' }}>
                    #{h.number}
                  </td>
                  <td style={{ padding: '0.4rem 0.3rem', opacity: h.done ? 0.55 : 1 }}>
                    {h.title}
                    {h.sprint ? <span style={{ color: 'var(--color-fg-muted)' }}> · {h.sprint}</span> : null}
                  </td>
                  <td style={{ padding: '0.4rem 0.3rem', color: 'var(--color-fg-muted)', whiteSpace: 'nowrap' }}>{h.state}</td>
                  <td style={{ padding: '0.4rem 0.3rem', textAlign: 'right' }}>
                    <CopyRow value={`/task ${h.number}`} label={t('Copiar /task', 'Copy /task')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
          <Link href={`/projects/${slug}/board`}>{t('Ver el tablero →', 'Open the board →')}</Link>
        </p>
      </section>

      {/* Step 4 — close the HU (QA handoff) */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>4</span>
          {t('Cerrar la HU (entrega a QA)', 'Close the story (QA handoff)')}
        </h3>
        <p style={lead}>
          {t(
            'Cuando terminaste el desarrollo, corré el comando de cierre. Evalúa que se cumplieron los criterios de aceptación, genera pruebas de QA sugeridas, arma el listado de tareas ejecutadas, actualiza el checklist de cumplimiento y publica todo en los comentarios de la HU; además mueve la HU a Verificación para que la tome QA.',
            'When development is done, run the close command. It checks the acceptance criteria, generates suggested QA tests, builds the executed-tasks list, updates the compliance checklist, and posts everything to the story comments; it also moves the story to Verification for QA to pick up.',
          )}
        </p>
        <CopyRow value={`/cerrar-hu ${exampleN}`} />
        <p style={{ ...lead, margin: '0.5rem 0 0.2rem' }}>
          {t('Por dentro llama a la herramienta MCP ', 'Under the hood it calls the MCP tool ')}
          <code style={mono}>submit_qa_review</code>
          {t(' con un payload como:', ' with a payload like:')}
        </p>
        <Sample>
          {`submit_qa_review {
  projectSlug: "${slug}", taskNumber: ${exampleN},
  criteria: [{ text: "El login valida credenciales", met: true }, ...],
  suggestedTests: [
    { title: "Login OK", steps: "1) credenciales válidas 2) enviar", expected: "entra al dashboard" },
    { title: "Login inválido", steps: "clave incorrecta", expected: "muestra error, no entra" }
  ],
  executedTasks: ["Formulario de login", "Endpoint POST /login", "Tests unitarios"],
  notes: "Contexto adicional para QA (decisiones, riesgos, cómo probar)."
}`}
        </Sample>
        <p style={{ ...lead, margin: '0.4rem 0 0' }}>
          {t('La HU pasa a ', 'The story moves to ')}
          <strong>{t('Verificación', 'Verification')}</strong>
          {t(' y aparece en la pestaña ', ' and shows up in the ')}
          <Link href={`/projects/${slug}/qa`}>QA</Link>
          {t(', donde QA ve tus pruebas sugeridas, genera las suyas y aprueba o rechaza.', ', where QA sees your suggested tests, generates its own, and approves or rejects.')}
        </p>
        <p style={{ ...lead, margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
          {t('Nota: el comando /cerrar-hu se instala con Fusion Code; si no lo ves, actualizá con ', 'Note: the /cerrar-hu command ships with Fusion Code; if you do not see it, update with ')}
          <code style={mono}>qwen extensions update --all</code>.
        </p>
      </section>

      {/* Step 5 — sync + next */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>
          <span style={stepNum}>5</span>
          {t('Sincronizar y seguir', 'Sync and continue')}
        </h3>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--color-fg-muted)', fontSize: '0.88rem', lineHeight: 1.7 }}>
          <li>
            <code style={mono}>/sync</code> — {t('sincroniza el cerebro del proyecto y publica los aprendizajes de lo que hiciste (para que el equipo los tenga).', 'syncs the project brain and publishes what you learned (so the team has it).')}
          </li>
          <li>
            {t('Usá la skill ', 'Use the ')}<code style={mono}>commit</code>{t(' y ', ' and ')}<code style={mono}>pr</code>{t(' para generar el commit y el PR; y ', ' skills to generate the commit and PR; and ')}<code style={mono}>/task &lt;otra&gt;</code>{t(' para pasar a la siguiente HU.', ' to move to the next story.')}
          </li>
          <li>
            <code style={mono}>/doctor</code> — {t('en cualquier momento, diagnostica el setup completo (qwen, extensión, tokens, endpoint del modelo y salud de los MCP).', 'anytime, diagnoses the whole setup (qwen, extension, tokens, model endpoint and MCP health).')}
          </li>
        </ul>
      </section>

      {/* Skills package */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>{t('Paquete de skills (buenas prácticas)', 'Skills package (best practices)')}</h3>
        <p style={lead}>
          {t(
            'El equipo comparte un paquete de skills: comandos y guías de buenas prácticas (E2E obligatorio, cobertura unitaria ≥ 90%, lint + tests antes del push, principios SOLID, y /cerrar-hu). Sincronizalos a Fusion Code con un comando:',
            'The team shares a skills package: best-practice commands and guidelines (E2E required, ≥ 90% unit coverage, lint + tests before push, SOLID principles, and /cerrar-hu). Sync them into Fusion Code with one command:',
          )}
        </p>
        <CopyRow value={'/skills sync'} />
        <p style={{ ...lead, margin: '0.4rem 0 0' }}>
          {t('Los skills quedan disponibles como comandos en ', 'The skills become commands in ')}
          <code style={mono}>~/.qwen</code>
          {t('. Podés ver el catálogo completo, descargar cualquiera como .md, o contribuir uno nuevo (entra a revisión) en la vista ', '. You can browse the full catalog, download any as .md, or contribute a new one (goes to review) in the ')}
          <a href="/skills" target="_blank" rel="noreferrer">{t('Skills', 'Skills')}</a>
          {t(' de Axon. Si escribís un skill útil, subilo con ', ' view in Axon. If you write a useful skill, submit it with ')}
          <code style={mono}>submit_skill</code>
          {t(' para compartirlo con el equipo.', ' to share it with the team.')}
        </p>
      </section>

      {/* Reference — commands */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>{t('Referencia — comandos', 'Reference — commands')}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <tbody>
            {commands.map((c) => (
              <tr key={c.cmd} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '0.4rem 0.5rem 0.4rem 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  <code style={mono}>{c.cmd}</code>
                </td>
                <td style={{ padding: '0.4rem 0.5rem', verticalAlign: 'top', color: 'var(--color-fg-muted)' }}>{c.desc}</td>
                <td style={{ padding: '0.4rem 0 0.4rem 0.5rem', textAlign: 'right', verticalAlign: 'top' }}>
                  <CopyRow value={c.ex} label={t('Copiar', 'Copy')} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Reference — skills */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.3rem' }}>{t('Referencia — skills', 'Reference — skills')}</h3>
        <p style={{ ...lead, margin: '0 0 0.4rem' }}>
          {t('Los skills se invocan pidiéndoselo a Qwen en lenguaje natural (p. ej. «usá la skill verify»).', 'Invoke a skill by asking Qwen in plain language (e.g. "use the verify skill").')}
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--color-fg-muted)', fontSize: '0.86rem', lineHeight: 1.7 }}>
          {skills.map((s) => (
            <li key={s.name}>
              <code style={mono}>{s.name}</code> — {s.desc}
            </li>
          ))}
        </ul>
      </section>

      {/* Reference — MCP tools */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.3rem' }}>{t('Referencia — tools MCP (axon)', 'Reference — MCP tools (axon)')}</h3>
        <p style={{ ...lead, margin: '0 0 0.4rem' }}>
          {t('Qwen usa estas herramientas del MCP «axon» por vos; no hace falta invocarlas a mano.', 'Qwen uses these "axon" MCP tools for you; you rarely call them by hand.')}
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--color-fg-muted)', fontSize: '0.86rem', lineHeight: 1.7 }}>
          {mcpTools.map((m) => (
            <li key={m.name}>
              <code style={mono}>{m.name}</code> — {m.desc}
            </li>
          ))}
        </ul>
      </section>

      {/* Troubleshooting */}
      <section style={card}>
        <h3 style={{ margin: '0 0 0.5rem' }}>{t('Solución de problemas', 'Troubleshooting')}</h3>
        <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--color-fg-muted)', fontSize: '0.86rem', lineHeight: 1.7 }}>
          <li>
            <strong>{t('«qwen» no se reconoce', '"qwen" not found')}</strong>: {t('abrí una terminal NUEVA (para recargar el PATH) o reinstalá con ', 'open a NEW terminal (to reload PATH) or reinstall with ')}<code style={mono}>npm install -g @qwen-code/qwen-code</code>.
          </li>
          <li>
            <strong>401 / {t('token inválido', 'invalid token')}</strong>: {t('el token del modelo fue revocado o es de otro modelo — generá uno nuevo en Coding Tools y actualizá ', 'the model token was revoked or belongs to another model — generate a new one in Coding Tools and update ')}<code style={mono}>OPENAI_API_KEY</code> {t('en', 'in')} <code style={mono}>~/.qwen/.env</code>.
          </li>
          <li>
            <strong>{t('el editor no ve mis tareas', "the editor can't see my tasks")}</strong>: {t('revisá que ', 'check that ')}<code style={mono}>AXON_API_TOKEN</code> {t('esté en ', 'is in ')}<code style={mono}>~/.qwen/.env</code> {t('y que exista ', 'and that ')}<code style={mono}>.axon/config.json</code> {t('con el projectSlug correcto; corré ', 'exists with the right projectSlug; run ')}<code style={mono}>/doctor</code>.
          </li>
          <li>
            <strong>{t('el modelo no responde', "the model doesn't respond")}</strong>: {t('revisá la ', 'check the ')}<code style={mono}>baseUrl</code> {t('en', 'in')} <code style={mono}>~/.qwen/settings.json</code> {t('y abrí una terminal nueva.', 'and open a new terminal.')}
          </li>
          <li>
            <strong>{t('desactualizado', 'out of date')}</strong>: <code style={mono}>qwen extensions update --all</code> ({t('o se auto-actualiza).', 'or it auto-updates).')}
          </li>
        </ul>
      </section>
    </div>
  );
}
