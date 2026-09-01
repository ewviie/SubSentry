# Local Council — SubSentry product/value audit

**Local council** — these perspectives all come from Claude playing different roles, not from different AI vendors. Treat agreement as a shared starting point to pressure-test, not as independent confirmation. (The plugin's built-in roles are all engineering-review lenses — security/performance/scalability/etc. — a poor fit for a product-value audit, so 4 custom product-appropriate roles were used instead: Retention & Habit-Formation Strategist, Fintech Trust & Data-Honesty Skeptic, Ruthless Product Editor, Data-Opportunity & Intelligence-Loop Scout.)

## 🗳️ Retention & Habit-Formation Strategist
Position: no genuine pull-back loop exists — everything is pull (compute-on-read), not push. Flagship "catch a price hike" moment fires only off the user's own manual edit. Weekly digest, the one designed recurring touchpoint, defaults off. No score/health movement is narrated between visits. Confidence: medium.

## 🗳️ Fintech Trust & Data-Honesty Skeptic
Position: the money-facing code is unusually honest — never fabricates savings/usage, confirmed-tier duplicates are real, health-score confidence downgrades when evidence is thin. But that honesty is inert by default: no background sync means zero notifications for a user who doesn't manually return. Confidence: high.

## 🗳️ Ruthless Product Editor
Position: not a feature-count problem, a renders-per-fact problem. Analytics duplicates Dashboard's own cards verbatim. `free.biggest_subscription`/`cheapest_subscription` are trivia dressed as savings. Health Score and Optimization Score compete for the same slot (codebase comment admits a merge was tried and reverted). PositiveHabitsCard is reassurance theater. `upcoming_renewal` notifications fire for every subscription every week — a calendar reimplemented as a feed. Confidence: high.

## 🗳️ Data-Opportunity & Intelligence-Loop Scout
Position: highest leverage is closing the loop between data already collected and moments it's thrown away. Sync is 100% manual (`vercel.json` has only 2 crons, both read-only summarizers). `dismissedSavingsRecommendations` is written but never read by the notification generator. `lastReviewedAt` is underused (only feeds staleness, not cross-referenced against price-history to know if a hike was already seen). `unusual_charge` is declared in the schema enum but has no generator — the module the code comments reference doesn't exist. Confidence: medium.

---

Full synthesis delivered to the user in-conversation (ranked 15, dramatic 5, product critique, DATA→FEEDBACK loop, next build phase).
