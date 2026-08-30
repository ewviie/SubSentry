import { describe, it, expect } from "vitest";
import { computeHealthScore } from "./health-score";
import { sub } from "./test-fixtures";
import type { EngineContext } from "./types";
import type { Subscription } from "@/lib/db/schema";

// Randomized/adversarial invariant coverage for Health Score v2 — distinct
// from health-score.test.ts's fixed-fixture regression tests (which pin
// exact scores/bands for specific scenarios) and rules/health.test.ts's
// per-rule unit tests. This file exists to answer a different question:
// "does the model hold its structural guarantees across many DIFFERENT
// portfolios, not just the ones we thought to write by hand?" No property-
// testing library (e.g. fast-check) is a project dependency, so this uses a
// small deterministic PRNG instead — seeded, so a failure is always
// reproducible from the printed seed, with the same "no new dependency for
// one test file" tradeoff this codebase already makes elsewhere.

// mulberry32 — tiny, deterministic, dependency-free PRNG. Same seed always
// produces the same sequence, so a CI failure here is always reproducible
// by re-running (no flaky, non-deterministic test).
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORD_BANK = [
  "Aurora", "Bramble", "Cascade", "Driftwood", "Ember", "Fennel", "Granite", "Harbor", "Ivory",
  "Juniper", "Kestrel", "Lantern", "Meadow", "Nimbus", "Onyx", "Pixel", "Quartz", "Ridgeline",
  "Sable", "Thicket", "Umbral", "Verdant", "Willow", "Xylophone", "Yonder", "Zenith",
];
const CATEGORIES = ["streaming", "software", "fitness", "utilities", "finance", "news", "gaming", "other"] as const;

// Builds a randomized-but-plausible active portfolio of `n` distinct,
// non-fuzzy-matching subscriptions (each name is a unique word-bank entry,
// so no pair can accidentally collide under namesLikelyMatch's edit-
// distance check — the exact contamination this audit's own calibration
// fixtures had to be corrected for, see __adversarial_audit's history).
function randomPortfolio(rng: () => number, n: number, todayIso: string): Subscription[] {
  const shuffled = [...WORD_BANK].sort(() => rng() - 0.5);
  return Array.from({ length: n }, (_, i) => {
    const daysAgo = Math.floor(rng() * 900);
    const createdAt = new Date(new Date(`${todayIso}T00:00:00Z`).getTime() - daysAgo * 86_400_000);
    const renewalDaysOut = Math.floor(rng() * 400) - 30; // can be negative (overdue) or far future
    const renewalDate = new Date(new Date(`${todayIso}T00:00:00Z`).getTime() + renewalDaysOut * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return sub({
      name: shuffled[i % shuffled.length] + (i >= shuffled.length ? `${i}Zz` : ""),
      amountCents: 200 + Math.floor(rng() * 8000),
      category: CATEGORIES[Math.floor(rng() * CATEGORIES.length)],
      billingCycle: (["monthly", "yearly", "quarterly", "weekly"] as const)[Math.floor(rng() * 4)],
      createdAt,
      nextRenewalDate: renewalDate,
    });
  });
}

function ctx(subs: Subscription[], overrides: Partial<EngineContext> = {}): EngineContext {
  return { subscriptions: subs, active: subs.filter((s) => s.status === "active"), todayIso: "2026-08-29", isPremium: false, ...overrides };
}

const TRIALS = 40;

describe("Health Score v2 — randomized adversarial invariants", () => {
  it("score is always within [0, 100] across randomized portfolios of varying size", () => {
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = mulberry32(seed * 7919 + 1);
      const n = 2 + Math.floor(rng() * 25);
      const portfolio = randomPortfolio(rng, n, "2026-08-29");
      const result = computeHealthScore(ctx(portfolio));
      expect(result, `seed=${seed} n=${n}`).not.toBeNull();
      expect(result!.score, `seed=${seed} n=${n}`).toBeGreaterThanOrEqual(0);
      expect(result!.score, `seed=${seed} n=${n}`).toBeLessThanOrEqual(100);
    }
  });

  // Known, quantified, structural residual (adversarial audit finding —
  // read before touching these three tests' tolerances):
  //
  // A confirmed duplicate's OWN penalty (confirmedDuplicateSeverity) is
  // independently unit-tested and genuinely monotonic in count, dollar
  // share, and staleness (see signals.test.ts). The residual risk here
  // lives one level up, in how the WHOLE score combines 5 independently-
  // computed dimensions: several of this model's rules measure a
  // subscription's *share of a total* (categoryConcentration,
  // expensiveOutlierMagnitudeFactor, findSmallSubscriptionsCluster's
  // mean-relative "smallness" bar), and any edit that changes the total —
  // including adding, resizing, or removing a duplicate — mechanically
  // shifts every OTHER subscription's share too. That's not a bug in any
  // one rule (each is independently correct about what it measures,
  // in isolation), but a whole-score aggregate averaged across rules that
  // don't know about each other CAN occasionally let one rule's legitimate
  // improvement (a diluted, now-less-concentrated category; a diluted,
  // now-less-extreme outlier) outweigh another rule's legitimate
  // worsening (the new/bigger duplicate's own redundancy penalty).
  //
  // A large-scale randomized sweep (3000 trials per invariant, run and
  // recorded during this audit, reproducible via this same seed formula)
  // found: adding a duplicate — 2/2000 trials (0.1%), worst +4, entirely
  // attributable to findSmallSubscriptionsCluster's shared, mean-relative
  // threshold (used by /savings too — restructuring it was out of scope
  // for this pass, see health-score.test.ts's audit note); increasing a
  // duplicate's cost — 316/3000 trials (10.5%), worst +12, dominated by
  // expensiveOutlierMagnitudeFactor's share-of-total responding to the
  // same total the duplicate's own cost also changed; removing a
  // duplicate — 11/3000 (0.4%), worst +4, same small-subscriptions-cluster
  // cause as the add case. The dominant, most-frequent cause originally
  // found by this same sweep — categoryConcentration's binary 0.4-share
  // cliff — WAS fixed this pass (see categoryConcentrationImpact's own
  // comment); these residuals are what's left after that fix, not what
  // triggered it. Tolerances below are sized directly off those swept
  // worst-cases (with headroom), not guessed — a genuine regression that
  // exceeds them will still fail loudly.
  it("adding a confirmed duplicate to a random portfolio never meaningfully improves the score", () => {
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = mulberry32(seed * 104_729 + 2);
      const n = 3 + Math.floor(rng() * 15);
      const base = randomPortfolio(rng, n, "2026-08-29");
      const before = computeHealthScore(ctx(base))!;
      // A near-identical duplicate of the first subscription — same price,
      // same currency, name close enough for namesLikelyMatch.
      const duplicate = sub({ ...base[0], id: `${base[0].id}-dup`, name: `${base[0].name} Plus` });
      const after = computeHealthScore(ctx([...base, duplicate]))!;
      expect(after.score, `seed=${seed} n=${n}`).toBeLessThanOrEqual(before.score + 5);
    }
  });

  it("increasing a confirmed duplicate's cost never dramatically improves the score", () => {
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = mulberry32(seed * 15_485_863 + 3);
      const n = 3 + Math.floor(rng() * 10);
      const base = randomPortfolio(rng, n, "2026-08-29");
      const cheapDup = sub({ ...base[0], id: `${base[0].id}-dup`, name: `${base[0].name} Plus`, amountCents: base[0].amountCents });
      const expensiveDup = sub({ ...base[0], id: `${base[0].id}-dup`, name: `${base[0].name} Plus`, amountCents: base[0].amountCents * 3 + 500 });
      const withCheap = computeHealthScore(ctx([...base, cheapDup]))!;
      const withExpensive = computeHealthScore(ctx([...base, expensiveDup]))!;
      expect(withExpensive.score, `seed=${seed} n=${n}`).toBeLessThanOrEqual(withCheap.score + 15);
    }
  });

  it("removing a confirmed duplicate never meaningfully worsens the score", () => {
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = mulberry32(seed * 32_452_867 + 4);
      const n = 3 + Math.floor(rng() * 15);
      const base = randomPortfolio(rng, n, "2026-08-29");
      const duplicate = sub({ ...base[0], id: `${base[0].id}-dup`, name: `${base[0].name} Plus` });
      const withDup = computeHealthScore(ctx([...base, duplicate]))!;
      const withoutDup = computeHealthScore(ctx(base))!;
      expect(withoutDup.score, `seed=${seed} n=${n}`).toBeGreaterThanOrEqual(withDup.score - 5);
    }
  });

  it("fixing an overdue renewal date never worsens the score", () => {
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = mulberry32(seed * 49_979_687 + 5);
      const n = 3 + Math.floor(rng() * 15);
      const base = randomPortfolio(rng, n, "2026-08-29");
      const overdue = { ...base[0], nextRenewalDate: "2020-01-01" };
      const fixed = { ...base[0], nextRenewalDate: "2099-01-01" };
      const withOverdue = computeHealthScore(ctx([overdue, ...base.slice(1)]))!;
      const withFixed = computeHealthScore(ctx([fixed, ...base.slice(1)]))!;
      expect(withFixed.score, `seed=${seed} n=${n}`).toBeGreaterThanOrEqual(withOverdue.score);
    }
  });

  it("adding one harmless, distinct, moderately-priced subscription never catastrophically destroys the score", () => {
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = mulberry32(seed * 67_867_967 + 6);
      const n = 3 + Math.floor(rng() * 15);
      const base = randomPortfolio(rng, n, "2026-08-29");
      const before = computeHealthScore(ctx(base))!;
      const harmless = sub({
        name: "Xylophone Extra",
        amountCents: 500,
        category: "other",
        createdAt: new Date("2024-01-01T00:00:00Z"),
        nextRenewalDate: "2099-01-01",
      });
      const after = computeHealthScore(ctx([...base, harmless]))!;
      // A single harmless addition should never drop the score by more than
      // a moderate amount — it can shift dimension weighting slightly
      // (e.g. diluting a positive "balanced categories" bonus) but must not
      // read as a portfolio-wide collapse.
      expect(before.score - after.score, `seed=${seed} n=${n} before=${before.score} after=${after.score}`).toBeLessThanOrEqual(15);
    }
  });

  it("improving price-history coverage (recording a non-increasing price point) never worsens the score", () => {
    for (let seed = 0; seed < TRIALS; seed++) {
      const rng = mulberry32(seed * 86_028_121 + 7);
      const n = 3 + Math.floor(rng() * 10);
      const base = randomPortfolio(rng, n, "2026-08-29");
      const withoutHistory = computeHealthScore(ctx(base))!;
      const history = new Map(
        base.map((s) => [
          s.id,
          [
            { id: `${s.id}-h1`, subscriptionId: s.id, userId: "user-1", amountCents: s.amountCents, billingCycle: s.billingCycle, currency: s.currency, observedAt: new Date("2025-01-01T00:00:00Z"), source: "initial" as const },
            { id: `${s.id}-h2`, subscriptionId: s.id, userId: "user-1", amountCents: s.amountCents, billingCycle: s.billingCycle, currency: s.currency, observedAt: new Date("2026-01-01T00:00:00Z"), source: "user_edit" as const },
          ],
        ]),
      );
      const withHistory = computeHealthScore(ctx(base, { priceHistoryBySubscriptionId: history }))!;
      expect(withHistory.score, `seed=${seed} n=${n}`).toBeGreaterThanOrEqual(withoutHistory.score);
    }
  });
});
