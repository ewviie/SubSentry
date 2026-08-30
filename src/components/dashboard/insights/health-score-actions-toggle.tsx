"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Audit fix #6: ScoreBreakdownCard (insight-panels.tsx, a Server Component)
// used to render every dimension's recommendedAction inline, always visible
// — for an account with real findings in most of the 5 dimensions, that's
// up to 5 extra full sentences of advice on top of the 5 summary lines,
// unfolded by default in a section that already has 3 sibling cards. The
// summary line (what's true, per dimension) stays inline — that's the
// actual "how the score was calculated" fact. The recommendedAction line
// (what to do about it) moves behind this single toggle instead: still
// fully readable, opt-in rather than forced.
//
// No pre-existing single-item disclosure component exists in this codebase
// to reuse — the only expandable primitive is ui/accordion.tsx's Accordion,
// which is built for FAQ-style grouped items (faq-section.tsx) and takes a
// "use client" boundary + Root/Item/Trigger/Panel wiring that's more
// machinery than a single boolean needs here. This mirrors that primitive's
// visual language exactly (same chevron-flip trigger, same
// text-sm/font-medium/hover:underline treatment) via a plain useState
// toggle instead, so it reads as the same interaction pattern without
// pulling grouped-accordion semantics in for one item.
//
// A separate client file (not "use client" on insight-panels.tsx itself)
// specifically to keep every sibling card in that file — Savings
// opportunities, Quick wins, Risk alerts, etc. — a Server Component. Adding
// "use client" at the top of insight-panels.tsx would flip all of them to
// client rendering for the sake of one toggle in one card.
export function HealthScoreActionsToggle({ actions }: { actions: { label: string; action: string }[] }) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium hover:underline"
      >
        Recommended actions
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="mt-2 space-y-2 text-sm">
          {actions.map((a) => (
            <p key={a.label}>
              <span className="font-medium text-foreground">{a.label}:</span>{" "}
              <span className="text-muted-foreground">{a.action}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
