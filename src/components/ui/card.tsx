import * as React from "react"

import { cn } from "@/lib/utils"

function Card({
  className,
  size = "default",
  highlight = false,
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm"; highlight?: boolean }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 shadow-xs [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        // Named "highlight" treatment so every place that wants to call out
        // a card as premium/upgraded (the Pro plan card today; a featured
        // insight tomorrow) composes one primitive instead of re-deriving
        // the same border/shadow/ring combination per usage. This exact
        // class list used to be hand-assembled inline in Settings.
        highlight && "border border-emerald/30 shadow-elevation-glow ring-1 ring-emerald/20",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

// Renders a real heading element, not a <div>. Every CardTitle across the
// app used to render a <div>, which meant dozens of visually-heading-styled
// card titles were invisible to a screen reader's heading-navigation list
// entirely. Defaults to h3: in every audited page (dashboard, settings,
// subscriptions), a CardTitle sits under the page's own <h1> and, where the
// page groups cards into named sections, under an <h2> section header, h3
// is the correct next level with no skip. Pages where a CardTitle is the
// *only* heading (the auth pages' "Welcome back" / "Create your account")
// pass `as="h1"` explicitly rather than relying on this default. Tailwind's
// Preflight already zeroes default heading margins, so switching the
// rendered tag doesn't introduce spacing regressions the way it would
// without that reset.
function CardTitle({
  className,
  as: Comp = "h3",
  ...props
}: React.ComponentProps<"h3"> & { as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" }) {
  return (
    <Comp
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
