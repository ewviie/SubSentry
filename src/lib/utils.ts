import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function initials(name: string | null, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/)
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase()
  }
  return email[0]?.toUpperCase() ?? "?"
}

// "Just now" / "3h ago" / "5d ago" / a plain date once it's old enough that
// a relative figure stops being useful at a glance — used by the
// notification center (bell dropdown + /notifications), the one place in
// this app that shows a live-feed timestamp rather than a fixed date like
// nextRenewalDate or createdAt elsewhere.
export function formatRelativeTime(date: Date, now: number = Date.now()): string {
  const diffMs = now - date.getTime()
  if (diffMs < 0) return "Just now" // clock skew guard, never "in the future"
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
