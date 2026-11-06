'use client';

import { Loading } from '@/components/loading';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSiteSelection } from '@/hooks/use-site-selection';
import type { Site } from '@/lib/types';
import { Empty, ErrorAlert } from '@/components/notice';
import { Button } from '@/components/ui/button';

export function SiteWorkspace({ title, group, description, children }: {
  title: string; group: string; description?: string; children: (site: Site) => ReactNode;
}) {
  const { sites, site } = useSiteSelection();
  return <div className="space-y-6">
    <header className="space-y-2">
      <p className="text-sm text-muted-foreground">{group}{site && ` · ${site.name}`}</p>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
    </header>
    {sites.isPending && <Loading variant={title === 'Chat' ? 'chat' : title === 'Site view' ? 'video' : title === 'Site setup' ? 'setup' : title === 'Violations' ? 'cards' : 'panel'} label="Loading sites…" />}
    {sites.isError && <ErrorAlert error={sites.error} />}
    {sites.isSuccess && !site && <div className="space-y-4">
      <Empty message={sites.data.length ? 'Pick a site in the sidebar.' : 'No sites yet.'} hint={sites.data.length ? 'Choose which site to work with.' : 'Create a site to get started.'} />
      {!sites.data.length && <Button render={<Link href="/sites" />}>Go to Sites</Button>}
    </div>}
    {site && children(site)}
  </div>;
}
