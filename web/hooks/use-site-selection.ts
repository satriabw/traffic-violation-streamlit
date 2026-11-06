'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { allSites } from '@/lib/api';

export function useSiteSelection() {
  const params = useParams<{ siteId?: string }>();
  const search = useSearchParams();
  const sites = useQuery({ queryKey: ['sites', 'all'], queryFn: allSites });
  const requested = params.siteId || search.get('site');
  const siteId = requested || sites.data?.[0]?.id;
  const site = sites.data?.find(item => item.id === siteId);
  return { sites, siteId, site };
}
