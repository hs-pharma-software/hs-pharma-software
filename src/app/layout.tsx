import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RoleShell } from "@/components/layout/RoleShell";
import { SyncProvider } from "@/components/sync/SyncProvider";
import { AuthGate } from "@/components/auth/AuthGate";
import { ThemeProvider } from "@/components/layout/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Billora",
  description: "Offline-first pharmacy management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider>
          <AuthGate>
            <SyncProvider>
              <RoleShell>{children}</RoleShell>
            </SyncProvider>
          </AuthGate>
        </ThemeProvider>
      </body>
    </html>
  );
}
