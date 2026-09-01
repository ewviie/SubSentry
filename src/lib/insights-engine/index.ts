export * from "./engine";
export { computeHealthScore, RULE_RECOMMENDED_ACTION } from "./health-score";
export { computeOptimizationScore } from "./optimization-score";
// computeBiggestOpportunity (./biggest-opportunity) deliberately NOT
// re-exported here — its one UI consumer (BiggestOpportunityCard) was
// removed from insight-panels.tsx when the dashboard's "Needs your
// attention" panel replaced it (see attention-panel.tsx's own comment);
// nothing in the app imports it via this barrel anymore. The module and
// its own test suite are left in place, not deleted — a real, tested,
// self-contained function, just currently unwired rather than abandoned
// mid-build.
