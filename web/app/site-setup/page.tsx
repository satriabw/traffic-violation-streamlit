'use client';

import { Loading } from '@/components/loading';
import { Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { SetupTab } from '@/components/site/setup-tab';
import { SiteWorkspace } from '@/components/site-workspace';
import { workspaceHref } from '@/lib/navigation';

export default function Page() {
  const router = useRouter();
  return <Suspense fallback={<Loading variant="setup" label="Loading site setup…" />}>
    <SiteWorkspace title="Site setup" group="Setup">
      {site => <SetupTab key={site.id} siteId={site.id} onDetection={() => router.push(workspaceHref('/detection', site.id))} />}
    </SiteWorkspace>
  </Suspense>;
}
