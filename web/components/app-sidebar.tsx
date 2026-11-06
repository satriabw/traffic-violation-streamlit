'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Folder, LayoutDashboard, MapPin, MessageSquare, CirclePlay, Video, Settings2, ClipboardCheck, ScanLine, LogOut, LoaderCircle } from 'lucide-react';
import { CHAT_ENABLED } from '@/lib/api';
import { activeWorkspace, chatHref, workspaceHref } from '@/lib/navigation';
import { useSiteSelection } from '@/hooks/use-site-selection';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HealthDot } from '@/components/health-dot';

const groups = [
  { label: 'Monitoring', items: [
    { title: 'Overview', href: '/', icon: LayoutDashboard },
    { title: 'Site view', href: '/site-view', icon: Video },
    { title: 'Violations', href: '/violations', icon: ClipboardCheck },
    ...(CHAT_ENABLED ? [{ title: 'Chat', href: '/chat', icon: MessageSquare }] : []),
  ] },
  { label: 'Operations', items: [{ title: 'Detection', href: '/detection', icon: CirclePlay }] },
  { label: 'Setup', items: [
    { title: 'Sites', href: '/sites', icon: MapPin },
    { title: 'Site setup', href: '/site-setup', icon: Settings2 },
    { title: 'Files', href: '/files', icon: Folder },
  ] },
];

export function AppSidebar() {
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const pathname = usePathname();
  const routeParams = useParams<{ violationId?: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { sites, siteId, site } = useSiteSelection();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = activeWorkspace(pathname, search.get('tab'));
  const violationId = routeParams.violationId || (active === '/chat' ? search.get('violation') : null);
  function closeOnMobile() { if (isMobile) setOpenMobile(false); }
  function chooseSite(value: string | null) {
    if (!value) return;
    router.push(workspaceHref(active, value));
    closeOnMobile();
  }
  return <Sidebar>
    <SidebarHeader className="gap-5 px-4 py-5">
      <Link href={workspaceHref('/', siteId)} className="flex items-center gap-2.5 text-sm font-medium tracking-tight" onClick={closeOnMobile}><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ScanLine className="size-4" strokeWidth={1.75} /></span><span>Traffic Violation<span className="block text-xs font-normal text-muted-foreground">Operator console</span></span></Link>
      <div className="space-y-2">
        <Label htmlFor="sidebar-site">Site</Label>
        <Select value={site?.id ?? null} onValueChange={chooseSite} disabled={!sites.data?.length}>
          <SelectTrigger id="sidebar-site" className="w-full">{sites.isPending && <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}<SelectValue placeholder={sites.isPending ? 'Loading sites…' : 'Pick a site'}>{site?.name}</SelectValue></SelectTrigger>
          <SelectContent>{sites.data?.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        {sites.isError && <p role="alert" className="text-xs text-destructive">Could not load sites.</p>}
      </div>
    </SidebarHeader>
    <SidebarContent>{groups.map(group => <SidebarGroup key={group.label}>
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent><SidebarMenu>
        {group.items.map(({ title, href, icon: Icon }) => <SidebarMenuItem key={href}>
          <SidebarMenuButton render={<Link href={href === '/chat' && siteId && violationId ? chatHref(siteId, violationId) : workspaceHref(href, siteId)} />} isActive={active === href} aria-current={active === href ? 'page' : undefined} onClick={closeOnMobile}>
            <Icon strokeWidth={1.75} /><span>{title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>)}
      </SidebarMenu></SidebarGroupContent>
    </SidebarGroup>)}</SidebarContent>
    <SidebarFooter className="gap-3 border-t px-4 py-3"><HealthDot /><Button variant="ghost" size="sm" className="justify-start text-muted-foreground" disabled={signingOut} onClick={async () => { setSigningOut(true); setLogoutError(false); try { const response = await fetch('/auth/logout', { method: 'POST' }); if (!response.ok) throw new Error(); window.location.replace(new URL('/login', window.location.origin).href); } catch { setSigningOut(false); setLogoutError(true); } }}><LogOut className="size-4" strokeWidth={1.75} />{signingOut ? 'Signing out…' : 'Sign out'}</Button>{logoutError && <p role="alert" className="text-xs text-destructive">Could not sign out. Try again.</p>}</SidebarFooter>
  </Sidebar>;
}
