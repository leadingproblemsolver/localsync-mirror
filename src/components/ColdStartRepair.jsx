// P3 COLD_START_REPAIR — T-15
//
// Repair panel shown on IncidentDetail when an active incident has gone
// stale past STALENESS_THRESHOLD_MS. Three actions:
//   1. Re-fingerprint — recompute symptom_fingerprint from incident.symptom.
//   2. Re-run suggestions — nudge parent to reload patterns + suggestions.
//   3. Force-resolve — close the incident WITHOUT reinforcing patterns
//      (so a stale, abandoned incident doesn't poison retrieval).

import { useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Fingerprint, RefreshCw, XCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { FEATURE_FLAGS } from '@/lib/feature-flags';
import { fingerprintSymptom } from '@/lib/fingerprint';
import { generateAndPersistArtifact } from '@/lib/artifact';
import { isStale, staleAgeMs, formatStaleAge } from '@/lib/staleness';

export default function ColdStartRepair({ incident, onRepaired }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null); // 'refp' | 'resug' | 'force'
  const [confirmForce, setConfirmForce] = useState(false);
  const [forceOutcome, setForceOutcome] = useState('failure');

  if (!FEATURE_FLAGS.P3_COLD_START_REPAIR) return null;
  if (!incident || incident.status !== 'active') return null;
  if (!isStale(incident)) return null;

  const ageLabel = formatStaleAge(staleAgeMs(incident));

  async function doRefingerprint() {
    setBusy('refp');
    try {
      const next = fingerprintSymptom(incident.symptom || '');
      await base44.entities.Incident.update(incident.id, {
        symptom_fingerprint: next,
      });
      toast.success('Re-fingerprinted symptom');
      onRepaired?.();
    } catch (err) {
      console.error('Re-fingerprint failed', err);
      toast.error('Re-fingerprint failed — try again');
    } finally {
      setBusy(null);
    }
  }

  async function doReSuggest() {
    setBusy('resug');
    try {
      // No DB write — just a state nudge. Parent reload re-fetches
      // patterns and SuggestionsBox re-evaluates getSuggestions().
      await Promise.resolve();
      onRepaired?.();
      toast.success('Refreshed suggestions');
    } catch (err) {
      console.error('Re-suggest failed', err);
      toast.error('Refresh failed — try again');
    } finally {
      setBusy(null);
    }
  }

  async function doForceResolve() {
    setBusy('force');
    try {
      await base44.entities.Incident.update(incident.id, {
        status: 'resolved',
        outcome: forceOutcome,
        resolved_at: new Date().toISOString(),
        root_cause_note: 'Force-resolved after staleness threshold.',
      });
      // Persist an artifact so the post-mortem row still exists.
      try {
        await generateAndPersistArtifact(incident.id);
      } catch (artErr) {
        // Artifact failure shouldn't block the close.
        console.error('Artifact persist failed on force-resolve', artErr);
      }
      toast.success('Incident force-resolved');
      navigate(`/incident/${incident.id}/report`);
    } catch (err) {
      console.error('Force-resolve failed', err);
      toast.error('Force-resolve failed — try again');
      setBusy(null);
    }
  }

  return (
    <div className="border border-amber-400/30 bg-amber-400/5 p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <span className="font-mono text-xs uppercase tracking-wider text-amber-400">
          Cold-start repair — stale for {ageLabel}
        </span>
      </div>

      <p className="font-mono text-xs text-muted-foreground mb-4 leading-relaxed">
        No activity past the staleness window. Recover the trace or close it out.
      </p>

      {!confirmForce ? (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={doRefingerprint}
            disabled={!!busy}
            className="flex items-center gap-2 px-3 py-1.5 border border-border text-foreground font-mono text-xs uppercase tracking-wider hover:border-primary hover:text-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Fingerprint className="w-3 h-3" />
            {busy === 'refp' ? 'Re-fingerprinting...' : 'Re-fingerprint'}
          </button>
          <button
            onClick={doReSuggest}
            disabled={!!busy}
            className="flex items-center gap-2 px-3 py-1.5 border border-border text-foreground font-mono text-xs uppercase tracking-wider hover:border-primary hover:text-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3 h-3 ${busy === 'resug' ? 'animate-spin' : ''}`} />
            {busy === 'resug' ? 'Refreshing...' : 'Re-run suggestions'}
          </button>
          <button
            onClick={() => setConfirmForce(true)}
            disabled={!!busy}
            className="flex items-center gap-2 px-3 py-1.5 border border-red-500/30 text-red-500 font-mono text-xs uppercase tracking-wider hover:bg-red-500/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <XCircle className="w-3 h-3" />
            Force-resolve
          </button>
        </div>
      ) : (
        <div className="border border-border bg-card p-3">
          <div className="font-mono text-xs text-muted-foreground mb-2">
            Force-resolve as:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={forceOutcome}
              onChange={e => setForceOutcome(e.target.value)}
              disabled={busy === 'force'}
              className="bg-card border border-border px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:border-primary"
            >
              <option value="failure">failure</option>
              <option value="success">success</option>
            </select>
            <button
              onClick={doForceResolve}
              disabled={busy === 'force'}
              className="px-3 py-1.5 bg-primary text-primary-foreground font-mono text-xs uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              {busy === 'force' ? 'Closing...' : 'Confirm force-resolve'}
            </button>
            <button
              onClick={() => setConfirmForce(false)}
              disabled={busy === 'force'}
              className="px-3 py-1.5 border border-border text-muted-foreground font-mono text-xs uppercase tracking-wider hover:text-foreground transition-all"
            >
              Cancel
            </button>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground/70 mt-2 leading-relaxed">
            Force-resolve does not reinforce patterns — abandoned traces shouldn't bias retrieval.
          </p>
        </div>
      )}
    </div>
  );
}
