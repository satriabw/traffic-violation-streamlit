'use client';

import { Loading } from '@/components/loading';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SiteWorkspace } from '@/components/site-workspace';
import { ViolationsQueue } from '@/components/violations-queue';

function Queue() {
  const runId = useSearchParams().get('run') || null;
  return <SiteWorkspace title="Violations" group="Monitoring" description="Current violations for this site. Runs judged under a document later marked invalid are left out.">
    {site => <ViolationsQueue key={JSON.stringify([site.id, runId])} siteId={site.id} runId={runId} showHeader={false} />}
  </SiteWorkspace>;
}

export default function Page() {
  return <Suspense fallback={<Loading variant="cards" label="Loading violations…" />}><Queue /></Suspense>;
}
