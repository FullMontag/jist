import type { Analyzer } from "./types";
import { subscriptionsAnalyzer } from "./subscriptions";
import { renewalsAnalyzer } from "./renewals";
import { opportunitiesAnalyzer } from "./opportunities";

// Registry is an ordered list — runs top to bottom in the weekly digest
export const ANALYZERS: Analyzer<unknown>[] = [
  subscriptionsAnalyzer,
  renewalsAnalyzer,
  opportunitiesAnalyzer,
];

export function getAnalyzer(id: string): Analyzer<unknown> | undefined {
  return ANALYZERS.find((a) => a.id === id);
}
