import Link from "next/link";
import Image from "next/image";

export function LandingFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <span className="flex items-center gap-2">
          <Image src="/logo-mark.png" alt="" width={20} height={20} className="size-5 rounded-full object-cover" aria-hidden="true" />
          SubSentry
        </span>
        <p>© {new Date().getFullYear()} SubSentry. All rights reserved.</p>
        <nav aria-label="Footer" className="flex items-center gap-4">
          <Link href="/login" className="hover:text-foreground">Log in</Link>
          <Link href="/signup" className="hover:text-foreground">Sign up</Link>
        </nav>
      </div>
    </footer>
  );
}
