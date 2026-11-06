'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { activeWorkspace } from '@/lib/navigation';
import { useSiteSelection } from '@/hooks/use-site-selection';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

const titles: Record<string, string> = {
  '/': 'Overview', '/site-view': 'Site view', '/violations': 'Violations', '/chat': 'Chat',
  '/detection': 'Detection', '/sites': 'Sites', '/site-setup': 'Site setup', '/files': 'Files',
};

export function WorkspaceHeader() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { site } = useSiteSelection();
  return <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
    <SidebarTrigger />
    <Separator orientation="vertical" className="h-4" />
    <span className="text-sm font-medium">{titles[activeWorkspace(pathname, search.get('tab'))] ?? 'Console'}</span>
    {site && <span className="ml-auto hidden truncate text-sm text-muted-foreground sm:block">{site.name}</span>}
  </header>;
}
