// Rank-aware divergence (legaps closure):
// A step is non-divergent if the actual action matches ANY suggestion in
// the persisted `suggestions_shown` array (top-N the user actually saw),
// not just the rank-1 `suggested_action`. Falls back to top-1 for legacy
// rows that predate persistence of the full ranked list.

import { normalizeAction } from '@/lib/fingerprint';

/**
 * @param {Array<{step_order:number, message:string, suggested_action?:string|null, suggestions_shown?:string[]|null}>} events
 */
export function computeDivergence(events) {
  const sorted = [...(events || [])].sort((a, b) => a.step_order - b.step_order);
  let total = 0;
  let diverged = 0;
  let firstDivergentStep = null;
  const perStep = [];

  for (const e of sorted) {
    const shownRaw = Array.isArray(e.suggestions_shown) ? e.suggestions_shown : [];
    const shown = shownRaw.filter(s => typeof s === 'string' && s.length > 0);
    const top1 = e.suggested_action || (shown[0] ?? null);
    // Effective ranked list used for matching:
    const ranked = shown.length > 0
      ? shown
      : (top1 ? [top1] : []);

    const actual = e.message || '';
    const actualNorm = normalizeAction(actual);
    let isDiverged = false;
    let matchedRank = null;

    if (ranked.length > 0) {
      total += 1;
      const idx = ranked.findIndex(s => normalizeAction(s) === actualNorm);
      if (idx === -1) {
        isDiverged = true;
        diverged += 1;
        if (firstDivergentStep === null) firstDivergentStep = e.step_order;
      } else {
        matchedRank = idx + 1; // 1-based
      }
    }

    perStep.push({
      step: e.step_order,
      diverged: isDiverged,
      suggested: top1,
      suggestionsShown: ranked,
      matchedRank,
      actual,
    });
  }

  return {
    total,
    diverged,
    firstDivergentStep,
    divergenceRate: total === 0 ? 0 : diverged / total,
    perStep,
  };
}
