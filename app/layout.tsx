import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { THEME_BOOTSTRAP } from "@/lib/theme/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adaptive Donchian Screener",
  description: "A rule-based Donchian reversal screener.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
        {children}
      </body>
    </html>
  );
}
