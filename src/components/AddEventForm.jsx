import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { FEATURE_FLAGS } from '@/lib/feature-flags';
import { Loader2 } from 'lucide-react';

export default function AddEventForm({
  incidentId,
  isFirstEvent,
  topSuggestion,
  topSuggestions,
  onEventAdded,
  onPreFillValueChange,
  preFillValue,
  initialStepOrder = 1,
  currentStepCount = 0,
}) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef(null);
  const nextStepRef = useRef(initialStepOrder);

  // If the parent's known event count grows beyond our local counter (e.g. on reload),
  // snap forward so we never reuse an existing step_order.
  useEffect(() => {
    if (initialStepOrder > nextStepRef.current) {
      nextStepRef.current = initialStepOrder;
    }
  }, [initialStepOrder]);

  // Update message when preFillValue changes (from suggestion click)
  useEffect(() => {
    if (preFillValue) {
      setMessage(preFillValue);
      if (textareaRef.current) {
        textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        textareaRef.current.focus();
      }
    }
  }, [preFillValue]);

  const placeholder = isFirstEvent
    ? 'What is the first thing you will check?'
    : 'What did you just check or decide?';

  async function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) return;

    setSubmitting(true);

    const stepOrder = nextStepRef.current;

    // Gap #3: persist the full ranked list the user actually saw, not only top-1.
    const rankedShown =
      Array.isArray(topSuggestions) && topSuggestions.length > 0
        ? topSuggestions.slice(0, 3)
        : topSuggestion
        ? [topSuggestion]
        : [];

    const payload = {
      incident_id: incidentId,
      message: message.trim(),
      step_order: stepOrder,
      event_type: 'message',
    };

    if (isFirstEvent && rankedShown.length > 0) {
      payload.suggested_action = rankedShown[0];
      payload.suggestions_shown = rankedShown;
    }

    // T-12: stamp logger when P2 user isolation is on. The DB also defaults
    // logged_by to auth.uid(), so this is belt-and-braces.
    if (FEATURE_FLAGS.P2_USER_ISOLATION) {
      try {
        const uid = await base44.auth.currentUserId();
        if (uid) payload.logged_by = uid;
      } catch {
        // non-fatal — DB default will fill in
      }
    }

    try {
      await base44.entities.IncidentEvent.create(payload);

      // T-07: client-side denormalized step_count, monotonic write only.
      // The DB trigger already does GREATEST(step_count, NEW.step_order),
      // so we only need to write when our value is strictly greater than
      // the parent's last-known value to avoid regressing it on a race.
      if (stepOrder > currentStepCount) {
        try {
          await base44.entities.Incident.update(incidentId, { step_count: stepOrder });
        } catch (err) {
          // The trigger has already corrected the counter — log only.
          console.error('Failed to update incident.step_count', err);
        }
      }

      nextStepRef.current = stepOrder + 1;
      setMessage('');

      if (onPreFillValueChange) {
        onPreFillValueChange(null);
      }

      onEventAdded();
    } catch (err) {
      console.error('Failed to log incident event', err);
      toast.error('Failed to log action — try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        ref={textareaRef}
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full bg-card border border-border px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors resize-none"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSubmit(e);
          }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground/40">⌘↵ to submit</span>
        <button
          type="submit"
          disabled={submitting || !message.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-accent border border-border text-foreground font-mono text-xs tracking-wider uppercase hover:border-primary hover:text-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Logging...
            </>
          ) : (
            'Log Action'
          )}
        </button>
      </div>
    </form>
  );
}
