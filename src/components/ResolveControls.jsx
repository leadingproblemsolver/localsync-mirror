import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { generateAndPersistArtifact } from '@/lib/artifact';
import { normalizeAction } from '@/lib/fingerprint';
import { FEATURE_FLAGS } from '@/lib/feature-flags';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export default function ResolveControls({ incidentId, service, firstEvent, patterns, symptomFingerprint = '', isTest = false, onResolved }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(null); // 'success' | 'failure'
  const [submitting, setSubmitting] = useState(false);
  const [rootCauseNote, setRootCauseNote] = useState('');

  async function handleResolve(outcome) {
    setSubmitting(true);

    try {
      // Update incident with root cause note and resolve status
      await base44.entities.Incident.update(incidentId, {
        status: 'resolved',
        outcome,
        resolved_at: new Date().toISOString(),
        root_cause_note: rootCauseNote || null,
      });

      // Reinforce pattern if there's a first event AND this isn't a test incident
      if (firstEvent && !isTest) {
        const firstAction = firstEvent.message;
        const normFirst = normalizeAction(firstAction);
        const existingPattern = patterns.find(
          p =>
            p.service === service &&
            (p.symptom_fingerprint || '') === symptomFingerprint &&
            normalizeAction(p.first_action) === normFirst
        );

        if (existingPattern) {
          await base44.entities.Pattern.update(existingPattern.id, {
            success_count: outcome === 'success'
              ? (existingPattern.success_count || 0) + 1
              : (existingPattern.success_count || 0),
            failure_count: outcome === 'failure'
              ? (existingPattern.failure_count || 0) + 1
              : (existingPattern.failure_count || 0),
          });
        } else {
          const patternPayload = {
            service,
            first_action: firstAction,
            symptom_fingerprint: symptomFingerprint,
            success_count: outcome === 'success' ? 1 : 0,
            failure_count: outcome === 'failure' ? 1 : 0,
          };
          // T-10: stamp owner when P2 user isolation is on. DB default
          // (auth.uid()) backs this up.
          if (FEATURE_FLAGS.P2_USER_ISOLATION) {
            try {
              const uid = await base44.auth.currentUserId();
              if (uid) patternPayload.owner_id = uid;
            } catch {
              // non-fatal — DB default will fill in
            }
          }
          await base44.entities.Pattern.create(patternPayload);
        }
      }

      // Generate and persist artifact
      await generateAndPersistArtifact(incidentId);

      setSubmitting(false);
      
      // Redirect to report page
      navigate(`/incident/${incidentId}/report`);
    } catch (error) {
      console.error('Error resolving incident:', error);
      setSubmitting(false);
      toast.error('Failed to resolve — try again');
    }
  }

  if (confirming) {
    return (
      <div className="border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-primary" />
          <span className="font-mono text-sm text-foreground">
            Resolve as <span className="font-medium">{confirming}</span>?
          </span>
        </div>
        
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
    <div className="flex gap-3">
      <button
        onClick={() => setConfirming('success')}
        className="flex items-center gap-2 px-4 py-2 border border-green-500/30 text-green-500 font-mono text-xs uppercase tracking-wider hover:bg-green-500/10 transition-all"
      >
        <CheckCircle className="w-3.5 h-3.5" />
        Resolve as success
      </button>
      <button
        onClick={() => setConfirming('failure')}
        className="flex items-center gap-2 px-4 py-2 border border-red-500/30 text-red-500 font-mono text-xs uppercase tracking-wider hover:bg-red-500/10 transition-all"
      >
        <XCircle className="w-3.5 h-3.5" />
        Resolve as failure
      </button>
    </div>
  );
}