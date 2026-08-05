#!/usr/bin/env node
// CI's dependency-audit gate. Plain `npm audit --audit-level=high` would
// fail on day one against this repo's current, already-triaged findings
// (see npm-audit-baseline.json), so the gate was previously loosened to
// `--audit-level=critical` instead — but that also silences a genuinely
// NEW high-severity finding landing in some unrelated dependency bump,
// which is the exact case a CI audit gate exists to catch. This script
// runs the real audit at the `high` threshold but only fails the build for
// a high/critical finding in a package that isn't already in the baseline.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const baselinePath = fileURLToPath(new URL("../npm-audit-baseline.json", import.meta.url));
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const accepted = new Set(baseline.acceptedHighOrCriticalPackages);

let auditJson;
try {
  // npm audit exits non-zero the moment it finds anything reportable, so
  // the JSON output has to be read off a thrown error's stdout, not a
  // successful call's.
  auditJson = execFileSync("npm", ["audit", "--json"], { encoding: "utf8" });
} catch (error) {
  auditJson = error.stdout;
}

if (!auditJson) {
  console.error("npm audit produced no output to parse.");
  process.exit(1);
}

const report = JSON.parse(auditJson);
const vulnerabilities = report.vulnerabilities ?? {};

const newSevereFindings = [];
const knownSevereFindings = [];

for (const [name, vuln] of Object.entries(vulnerabilities)) {
  if (vuln.severity !== "high" && vuln.severity !== "critical") continue;
  if (accepted.has(name)) {
    knownSevereFindings.push(name);
  } else {
    newSevereFindings.push(`${name} (${vuln.severity})`);
  }
}

if (knownSevereFindings.length > 0) {
  console.log(`Known, already-triaged high/critical findings (not blocking): ${knownSevereFindings.join(", ")}`);
}

if (newSevereFindings.length > 0) {
  console.error(`New high/critical npm audit finding(s) not in npm-audit-baseline.json: ${newSevereFindings.join(", ")}`);
  console.error("Triage these: either fix them, or add the package to npm-audit-baseline.json with a reason.");
  process.exit(1);
}

console.log("No new high/critical npm audit findings.");
