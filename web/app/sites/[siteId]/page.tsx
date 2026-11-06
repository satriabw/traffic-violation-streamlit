import { redirect } from 'next/navigation';
import { workspaceHref } from '@/lib/navigation';

export default async function Page({ params, searchParams }: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { siteId } = await params;
  const { tab } = await searchParams;
  redirect(workspaceHref(tab === 'setup' ? '/site-setup' : tab === 'detection' ? '/detection' : '/site-view', siteId));
}
