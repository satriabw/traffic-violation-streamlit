import { redirect } from 'next/navigation';

export default async function Page({ params, searchParams }: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { siteId } = await params;
  const { run } = await searchParams;
  const query = new URLSearchParams({ site: siteId });
  if (run) query.set('run', run);
  redirect(`/violations?${query}`);
}
