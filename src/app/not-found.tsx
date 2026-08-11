import Link from "next/link";

export default function RootNotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-medium">Page not found</h1>
      <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
        Back home
      </Link>
    </div>
  );
}
