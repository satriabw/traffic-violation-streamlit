'use client';

import { Loading } from '@/components/loading';
import { Suspense } from 'react';
import { DetectionTab } from '@/components/site/detection-tab';
import { SiteWorkspace } from '@/components/site-workspace';

export default function Page() {
  return <Suspense fallback={<Loading variant="panel" label="Loading detection…" />}>
    <SiteWorkspace title="Detection" group="Operations">
      {site => <DetectionTab key={site.id} siteId={site.id} />}
    </SiteWorkspace>
  </Suspense>;
}
