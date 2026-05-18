'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LlmProvider } from '@prisma/client';
import type { ProviderInfo } from '@/lib/ai/providers/types';
import { estimateCost, formatUsd } from '@/lib/ai/cost-estimator';
import { startStoryDraftAction } from '@/lib/actions/stories';
import styles from '../stories.module.scss';

interface CredentialOption {
  id: string;
  provider: LlmProvider;
  label: string;
  modelDefault: string | null;
  keyPrefix: string;
}

interface TreeNode {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  children?: TreeNode[];
  size?: number;
}

export function Composer({
  projectSlug,
  projectName,
  credentials,
  providers,
  repoTree,
  hasRepo,
}: {
  projectSlug: string;
  projectName: string;
  credentials: CredentialOption[];
  providers: ProviderInfo[];
  repoTree: TreeNode[];
  hasRepo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [rawInput, setRawInput] = useState('');
  const [credentialId, setCredentialId] = useState<string>(credentials[0]?.id ?? '');
  const selectedCred = useMemo(
    () => credentials.find((c) => c.id === credentialId),
    [credentials, credentialId],
  );
  const providerInfo = useMemo(
    () => providers.find((p) => p.name === selectedCred?.provider),
    [providers, selectedCred],
  );
  const [model, setModel] = useState<string>(
    selectedCred?.modelDefault ?? providerInfo?.defaultModel ?? '',
  );
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Cuando cambia la credencial, ajustamos modelo por default del provider
  useMemo(() => {
    if (selectedCred?.provider) {
      const pi = providers.find((p) => p.name === selectedCred.provider);
      setModel(selectedCred.modelDefault ?? pi?.defaultModel ?? '');
    }
  }, [credentialId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-flight cost estimate
  const cost = useMemo(() => {
    if (!selectedCred || !providerInfo || !model) return null;
    const promptText =
      `Proyecto: ${projectName}\nNecesidad:\n${rawInput}\n` +
      Array.from(selectedPaths).join('\n');
    return estimateCost({
      provider: selectedCred.provider,
      model,
      promptText,
      expectedOutputTokens: 1500,
      codeRatio: 0.6,
    });
  }, [rawInput, selectedCred, providerInfo, model, selectedPaths, projectName]);

  const toggle = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onGenerate = () => {
    if (!selectedCred) return setError('Selecciona una credencial LLM');
    if (rawInput.trim().length < 10) return setError('Describe la necesidad con un poco más de detalle');
    setError(null);
    startTransition(async () => {
      const res = await startStoryDraftAction(projectSlug, {
        rawInput: rawInput.trim(),
        provider: selectedCred.provider,
        model,
        credentialId,
        selectedPaths: Array.from(selectedPaths),
        citedMemoryIds: [],
      });
      if (!res.ok || !res.draftId) {
        setError(res.error ?? 'no se pudo crear el borrador');
        return;
      }
      router.push(`/projects/${projectSlug}/stories/drafts/${res.draftId}`);
    });
  };

  return (
    <div className={styles.composer}>
      <div className={styles.composerMain}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="rawInput">
            Necesidad
          </label>
          <textarea
            id="rawInput"
            className={styles.rawInput}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="Como product owner quiero exportar las tareas en CSV para preparar el reporte mensual…"
            autoFocus
          />
        </div>

        {hasRepo ? (
          <div className={styles.field}>
            <label className={styles.fieldLabel}>
              Archivos del repo a incluir ({selectedPaths.size} sel.)
            </label>
            <FileTree nodes={repoTree} selected={selectedPaths} toggle={toggle} />
          </div>
        ) : (
          <p>
            <em>No hay repositorio configurado para este proyecto. La generación funciona sin archivos, pero el contexto será más débil.</em>
          </p>
        )}
      </div>

      <aside className={styles.composerSide}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="cred">Credencial LLM</label>
          {credentials.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-fg-muted)' }}>
              Sin credenciales. <a href="/settings/llm-credentials">Configura una primero.</a>
            </p>
          ) : (
            <select
              id="cred"
              className={styles.select}
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
            >
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider} · {c.label} · {c.keyPrefix}…
                </option>
              ))}
            </select>
          )}
        </div>

        {providerInfo && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="model">Modelo</label>
            <select
              id="model"
              className={styles.select}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {providerInfo.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        {cost && (
          <div className={styles.costEstimate}>
            ~{cost.inputTokens + cost.outputTokens} tokens · <strong>{formatUsd(cost.totalCostUsd)}</strong>
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--accent-ink)', fontSize: '0.85rem', margin: 0 }}>
            {error}
          </p>
        )}

        <button
          type="button"
          className={styles.generateBtn}
          disabled={pending || credentials.length === 0 || !model}
          onClick={onGenerate}
        >
          {pending ? 'Creando borrador…' : 'Generar borrador'}
        </button>
      </aside>
    </div>
  );
}

function FileTree({
  nodes,
  selected,
  toggle,
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: Set<string>;
  toggle: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className={styles.fileList}>
      {nodes.map((n) => (
        <li key={n.path} style={{ paddingLeft: `calc(${depth} * 1rem)` }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', flex: 1 }}>
            <input
              type="checkbox"
              checked={selected.has(n.path)}
              onChange={() => toggle(n.path)}
            />
            <span>{n.kind === 'dir' ? '📁' : ' '} {n.name}</span>
          </label>
          {n.children && n.children.length > 0 && (
            <FileTree nodes={n.children} selected={selected} toggle={toggle} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}
