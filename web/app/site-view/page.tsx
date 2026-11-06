'use client';

import { Loading } from '@/components/loading';
import { Suspense } from 'react';
import { ViewTab } from '@/components/site/view-tab';
import { SiteWorkspace } from '@/components/site-workspace';

export default function Page() {
  return <Suspense fallback={<Loading variant="video" label="Loading site view…" />}>
    <SiteWorkspace title="Site view" group="Monitoring">
      {site => <ViewTab key={site.id} siteId={site.id} />}
    </SiteWorkspace>
  </Suspense>;
}
