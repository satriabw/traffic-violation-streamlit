"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { File, LayoutDashboard, MapPin } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { HealthDot } from "@/components/health-dot";

const items = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "Sites", href: "/sites", icon: MapPin },
  { title: "Files", href: "/files", icon: File },
];

export function AppSidebar() {
  const pathname = usePathname();
  return <Sidebar>
    <SidebarHeader className="px-4 py-5 font-semibold">Traffic Violation Console</SidebarHeader>
    <SidebarContent><SidebarGroup><SidebarMenu>
      {items.map(({ title, href, icon: Icon }) => <SidebarMenuItem key={href}>
        <SidebarMenuButton render={<Link href={href} />} isActive={href === "/" ? pathname === href : pathname.startsWith(href)}>
          <Icon /><span>{title}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>)}
    </SidebarMenu></SidebarGroup></SidebarContent>
    <SidebarFooter><HealthDot /></SidebarFooter>
  </Sidebar>;
}
