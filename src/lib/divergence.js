// Gap #11: divergence computed across the full event sequence,
// not only step 1.

import { normalizeAction } from '@/lib/fingerprint';

/**
 * @param {Array<{step_order:number, message:string, suggested_action?:string|null}>} events
 * @returns {{
 *   total: number,
 *   diverged: number,
 *   firstDivergentStep: number|null,
 *   divergenceRate: number,
 *   perStep: Array<{ step:number, diverged:boolean, suggested:string|null, actual:string }>
 * }}
 */
export function computeDivergence(events) {
  const sorted = [...(events || [])].sort((a, b) => a.step_order - b.step_order);
  let total = 0;
  let diverged = 0;
  let firstDivergentStep = null;
  const perStep = [];

  for (const e of sorted) {
    const suggested = e.suggested_action || null;
    const actual = e.message || '';
    let isDiverged = false;
    if (suggested) {
      total += 1;
      isDiverged = normalizeAction(suggested) !== normalizeAction(actual);
      if (isDiverged) {
        diverged += 1;
        if (firstDivergentStep === null) firstDivergentStep = e.step_order;
      }
    }
    perStep.push({ step: e.step_order, diverged: isDiverged, suggested, actual });
  }

  return {
    total,
    diverged,
    firstDivergentStep,
    divergenceRate: total === 0 ? 0 : diverged / total,
    perStep,
  };
}
