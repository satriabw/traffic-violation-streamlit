'use client';

import { Suspense, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Loading } from '@/components/loading';
import { AppSidebar } from '@/components/app-sidebar';
import { WorkspaceHeader } from '@/components/workspace-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login') return children;
  return <SidebarProvider>
    <Suspense fallback={<Loading variant="navigation" label="Loading navigation…" className="w-64 shrink-0 self-start p-4" />}><AppSidebar /></Suspense>
    <SidebarInset>
      <Suspense fallback={<Loading variant="heading" label="Loading workspace…" className="flex h-14 items-center border-b px-4" />}><WorkspaceHeader /></Suspense>
      <div className="flex-1 p-4 sm:p-6 lg:p-8">{children}</div>
    </SidebarInset>
  </SidebarProvider>;
}
