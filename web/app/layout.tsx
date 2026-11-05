import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/app/providers";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
export const metadata: Metadata = {
  title: "Traffic Violation Console", description: "Manage traffic violation sites and evidence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${inter.variable} h-full antialiased`}>
    <body className="min-h-full"><Providers><TooltipProvider><SidebarProvider>
      <Suspense fallback={<div className="w-64 shrink-0" aria-label="Loading navigation" />}><AppSidebar /></Suspense><SidebarInset>
        <header className="flex h-14 items-center border-b px-4"><SidebarTrigger /></header>
        <div className="flex-1 p-6">{children}</div>
      </SidebarInset><Toaster />
    </SidebarProvider></TooltipProvider></Providers></body>
  </html>;
}
