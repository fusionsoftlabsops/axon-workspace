'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './layout.module.scss';

export interface ProjectTab {
  href: string;
  label: string;
}

/**
 * Project sub-navigation with an active-tab indicator (the "Signal Console"
 * signal line). Labels are resolved server-side and passed in; this client
 * component only needs the current pathname to mark the active tab.
 *
 * Active = the tab whose href is the longest prefix of the current path, so
 * `/settings/audit` lights Audit (not Settings) and nested routes like
 * `/brain/<id>` keep Brain active.
 */
export function ProjectTabs({ tabs }: { tabs: ProjectTab[] }) {
  const pathname = usePathname() ?? '';

  let activeHref = '';
  for (const tab of tabs) {
    const matches = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    if (matches && tab.href.length > activeHref.length) activeHref = tab.href;
  }

  return (
    <nav className={styles.tabs}>
      {tabs.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? styles.active : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
