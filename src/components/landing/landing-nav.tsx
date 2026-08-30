"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
import { Button } from "@/components/ui/button";
import { SentryRing } from "@/components/ui/sentry-ring";
import { cn } from "@/lib/utils";

const SECTION_LINKS = [
  { href: "#pricing", label: "Pricing" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { scrollY } = useScroll();

  function closeMobileMenu() {
    setMobileOpen(false);
    menuButtonRef.current?.focus();
  }

  // Track a boolean rather than binding style directly to scrollY: the nav
  // should snap between two deliberate states (resting on the hero vs.
  // working chrome), not continuously interpolate every pixel of scroll.
  useMotionValueEvent(scrollY, "change", (latest) => {
    setScrolled(latest > 24);
  });

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,backdrop-filter,border-color,box-shadow,padding] duration-300",
        scrolled
          ? "border-border/60 bg-background/80 shadow-elevation-low backdrop-blur-md"
          : "border-transparent bg-transparent"
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape" && mobileOpen) closeMobileMenu();
      }}
    >
      <div
        className={cn(
          "mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 transition-[padding] duration-300 sm:px-6",
          scrolled ? "py-3" : "py-4"
        )}
      >
        <Link href="/" className="flex items-center gap-2.5 font-heading text-lg font-semibold">
          <span aria-hidden="true" className="relative flex size-8 items-center justify-center">
            <SentryRing />
            <Image src="/logo-mark.png" alt="" width={32} height={32} className="size-full rounded-full object-cover" />
          </span>
          SubSentry
        </Link>
        <nav aria-label="Section links" className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          {SECTION_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 sm:flex">
          <Button variant="ghost" render={<Link href="/login" />} nativeButton={false}>
            Log in
          </Button>
          <Button render={<Link href="/signup" />} nativeButton={false}>
            Start free
          </Button>
        </div>

        <div className="flex items-center gap-2 sm:hidden">
          <Button render={<Link href="/signup" />} nativeButton={false}>
            Start free
          </Button>
          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="icon"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-panel"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {mobileOpen ? (
          <motion.nav
            id="mobile-nav-panel"
            aria-label="Section links"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-t border-border/60 bg-background/95 backdrop-blur-md sm:hidden"
          >
            <div className="flex flex-col gap-1 px-4 py-3 text-sm">
              {SECTION_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md px-2 py-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="rounded-md px-2 py-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Log in
              </Link>
            </div>
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </motion.header>
  );
}
