import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
export const metadata: Metadata = {
  icons: { icon: "/icon.svg" },
  title: "Traffic Violation Console", description: "Manage traffic violation sites and evidence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${inter.variable} h-full antialiased`}>
    <body className="min-h-full"><Providers><TooltipProvider><AppShell>{children}</AppShell><Toaster /></TooltipProvider></Providers></body>
  </html>;
}
