import { getServerT } from '@/lib/i18n/server';
import { getMyGithubLogin } from '@/lib/actions/me';
import { GithubHandlePanel } from './GithubHandlePanel';

export default async function GithubSettingsPage() {
  const t = await getServerT();
  const githubLogin = await getMyGithubLogin();

  return (
    <div style={{ maxWidth: '720px', padding: '2rem 1.5rem' }}>
      <h1>{t('Usuario de GitHub', 'GitHub username')}</h1>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        {t(
          'Tu handle de GitHub. Se usa para verificar tu acceso a los repositorios del proyecto.',
          'Your GitHub handle. Used to verify your access to project repositories.',
        )}
      </p>
      <GithubHandlePanel initial={githubLogin} />
    </div>
  );
}
