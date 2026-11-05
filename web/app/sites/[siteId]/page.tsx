'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import type { Site } from '@/lib/types';
import { ErrorAlert } from '@/components/notice';
import { DetectionTab } from '@/components/site/detection-tab';
import { ViewTab } from '@/components/site/view-tab';
import { SetupTab } from '@/components/site/setup-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function SitePage() {
  const { siteId } = useParams<{ siteId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const requested = search.get('tab');
  const tab = requested === 'setup' || requested === 'detection' ? requested : 'view';
  const site = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => get<Site>(`/sites/${encodeURIComponent(siteId)}`),
  });

  function navigate(value: string) {
    const params = new URLSearchParams(search);
    params.set('tab', value);
    router.push(`/sites/${encodeURIComponent(siteId)}?${params}`, { scroll: false });
  }

  if (site.isPending) {
    return <p role="status">Loading site…</p>;
  }
  if (site.isError) {
    return <ErrorAlert error={site.error} />;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{site.data.name}</h1>
        <Link className="underline" href={`/sites/${encodeURIComponent(siteId)}/violations`}>Violations</Link>
      </header>
      <Tabs value={tab} onValueChange={navigate}>
        <TabsList>
          <TabsTrigger value="view">View</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="detection">Detection</TabsTrigger>
        </TabsList>
        <TabsContent value="view">{tab === 'view' && <ViewTab key={siteId} siteId={siteId} />}</TabsContent>
        <TabsContent value="setup">
          <SetupTab key={siteId} siteId={siteId} onDetection={() => navigate('detection')} />
        </TabsContent>
        <TabsContent value="detection">
          <DetectionTab key={siteId} siteId={siteId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<p role="status">Loading site…</p>}><SitePage /></Suspense>;
}
