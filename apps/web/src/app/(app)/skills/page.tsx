import { auth } from '@/auth';
import { getServerT } from '@/lib/i18n/server';
import { PageHeader, Eyebrow } from '@/components/ui';
import { loadSkills } from '@/lib/actions/skills';
import { SkillsClient } from './SkillsClient';

export default async function SkillsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();
  const isMaster = Boolean(session.user.isMasterUser);
  const skills = await loadSkills();

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <PageHeader
        eyebrow={<Eyebrow>{t('Fusion Code', 'Fusion Code')}</Eyebrow>}
        title={t('Paquete de skills', 'Skills package')}
        description={t(
          'Comandos y guías de buenas prácticas que todo el equipo comparte y sincroniza en Fusion Code. Descargá los skills, o contribuí uno nuevo para revisión.',
          'Best-practice commands and guidelines the whole team shares and syncs into Fusion Code. Download the skills, or contribute a new one for review.',
        )}
      />
      <SkillsClient initialSkills={skills} isMaster={isMaster} />
    </main>
  );
}
