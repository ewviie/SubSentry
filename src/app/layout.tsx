import type { Metadata } from "next";
import "./globals.css";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { MotionConfig } from "framer-motion";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "SubSentry",
  description: "AI-powered subscription management",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans",
        geist.variable,
        geistMono.variable,
        spaceGrotesk.variable,
      )}
    >
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
