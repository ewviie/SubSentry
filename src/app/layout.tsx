import type { Metadata } from "next";
import "./globals.css";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { MotionConfig } from "framer-motion";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Doubloon",
  description: "AI-powered subscription management",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans",
        geist.variable,
        geistMono.variable,
        spaceGrotesk.variable,
      )}
    >
      <body>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
        <Toaster />
      </body>
    </html>
  );
}
