import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { generateAndPersistArtifact } from '@/lib/artifact';
import { canonicalizeService } from '@/lib/service';
import { categorizeRca } from '@/lib/rca';
import { getCurrentOrgId } from '@/lib/org';
import { CheckCircle, ArrowDownCircle, AlertOctagon, ArrowUpCircle, AlertTriangle } from 'lucide-react';

// G8: richer resolution states. Maps to pattern reinforcement signal:
//   resolved/mitigated  -> success
//   rolled-back         -> neutral (don't punish the action that was the
//                          correct response, even if it didn't fix root cause)
//   escalated           -> failure
const OUTCOMES = [
  { id: 'resolved',    label: 'Resolved',    desc: 'Issue is fixed and the root cause is understood (or will be).', tone: 'success', signal: 'success', Icon: CheckCircle },
  { id: 'mitigated',   label: 'Mitigated',   desc: 'User impact stopped, but the underlying cause is still open.', tone: 'mitigated', signal: 'success', Icon: AlertOctagon },
  { id: 'rolled-back', label: 'Rolled back', desc: 'Reverted to a known-good state. Correct action even if not a fix.', tone: 'warn', signal: 'neutral', Icon: ArrowDownCircle },
  { id: 'escalated',   label: 'Escalated',   desc: 'Handed off — out of your team\'s control to resolve right now.', tone: 'failure', signal: 'failure', Icon: ArrowUpCircle },
];

const TONE_CLASSES = {
  success:   'border-green-500/30 text-green-500 hover:bg-green-500/10',
  mitigated: 'border-teal-400/30 text-teal-400 hover:bg-teal-400/10',
  warn:      'border-amber-400/30 text-amber-400 hover:bg-amber-400/10',
  failure:   'border-red-500/30 text-red-500 hover:bg-red-500/10',
};

export default function ResolveControls({ incidentId, service, firstEvent, patterns, symptomFingerprint = '', isTest = false, onResolved }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(null); // OUTCOMES.id
  const [submitting, setSubmitting] = useState(false);
  const [rootCauseNote, setRootCauseNote] = useState('');

  async function handleResolve(outcomeId) {
    const def = OUTCOMES.find(o => o.id === outcomeId);
    if (!def) return;
    setSubmitting(true);
    try {
      const rcaText = rootCauseNote.trim();
      await base44.entities.Incident.update(incidentId, {
        status: 'resolved',
        outcome: outcomeId,
        resolved_at: new Date().toISOString(),
        root_cause_note: rcaText || null,
        // G9: categorize on save (server trigger will recompute blind spots)
        rca_category: rcaText ? categorizeRca(rcaText) : null,
      });

      // G3 + G8: reinforce pattern via collision-safe RPC (0006). One atomic
      // upsert keyed on (org, canonical_service, fingerprint, first_action)
      // — eliminates the prior read/find/update-or-create race.
      // Neutral (rolled-back) leaves counters untouched.
      if (firstEvent && !isTest && def.signal !== 'neutral') {
        const orgId = await getCurrentOrgId();
        if (orgId) {
          const { error: rpcErr } = await base44.supabase.rpc('reinforce_pattern', {
            _org: orgId,
            _service: service,
            _canonical: canonicalizeService(service),
            _fingerprint: symptomFingerprint || '',
            _first_action: firstEvent.message,
            _success: def.signal === 'success' ? 1 : 0,
            _failure: def.signal === 'failure' ? 1 : 0,
          });
          if (rpcErr) {
            console.error('reinforce_pattern failed', rpcErr);
          }
        } else {
          console.warn('reinforce skipped: no org id resolved');
        }
      }

      await generateAndPersistArtifact(incidentId);

      setSubmitting(false);
      navigate(`/incident/${incidentId}/report`);
    } catch (error) {
      console.error('Error resolving incident:', error);
      setSubmitting(false);
      toast.error('Failed to resolve — try again');
    }
  }

  if (confirming) {
    const def = OUTCOMES.find(o => o.id === confirming);
    return (
      <div className="border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-primary" />
          <span className="font-mono text-sm text-foreground">
            Resolve as <span className="font-medium">{def.label}</span>?
          </span>
        </div>
        <p className="font-mono text-xs text-muted-foreground/70 mb-3">{def.desc}</p>

        <div className="mb-4">
          <label className="block font-mono text-xs text-muted-foreground mb-2">
            What was the actual root cause? <span className="text-muted-foreground/50">(optional)</span>
          </label>
          <textarea
            value={rootCauseNote}
            onChange={e => setRootCauseNote(e.target.value)}
            placeholder="Describe the root cause you discovered..."
            rows={3}
            className="w-full bg-card border border-border px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors resize-none"
          />
          <p className="font-mono text-xs text-muted-foreground/50 mt-1.5">
            You can add this later — we'll prompt you 24h after resolution.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => handleResolve(confirming)}
            disabled={submitting}
            className="px-4 py-2 bg-primary text-primary-foreground font-mono text-xs uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {submitting ? 'Generating Report...' : 'Resolve & Generate Report'}
          </button>
          <button
            onClick={() => setConfirming(null)}
            disabled={submitting}
            className="px-4 py-2 border border-border text-muted-foreground font-mono text-xs uppercase tracking-wider hover:text-foreground transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {OUTCOMES.map(o => {
        const { Icon } = o;
        return (
          <button
            key={o.id}
            onClick={() => setConfirming(o.id)}
            className={`flex items-start gap-2 px-3 py-2.5 border text-left font-mono text-xs transition-all ${TONE_CLASSES[o.tone]}`}
          >
            <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="uppercase tracking-wider font-medium">{o.label}</div>
              <div className="text-muted-foreground/70 normal-case tracking-normal mt-0.5">{o.desc}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
