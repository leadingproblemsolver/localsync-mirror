import { useState } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { generateAndPersistArtifact } from '@/lib/artifact';
import { categorizeRca } from '@/lib/rca';
import { Loader2 } from 'lucide-react';

/**
 * G7: Allow filling in / editing the root cause after resolution while the
 * postmortem is still pending. Saving flips rca_status to complete via the
 * DB trigger and regenerates the artifact so the markdown stays in sync.
 */
export default function PendingPostmortem({ incident, onUpdated }) {
  const [text, setText] = useState(incident.root_cause_note || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!text.trim()) {
      toast.error('Add a root cause first.');
      return;
    }
    setSaving(true);
    try {
      await base44.entities.Incident.update(incident.id, {
        root_cause_note: text.trim(),
        rca_category: categorizeRca(text),
      });
      await generateAndPersistArtifact(incident.id);
      toast.success('Postmortem completed.');
      onUpdated?.();
    } catch (e) {
      console.error(e);
      toast.error('Failed to save — try again');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-amber-400/30 bg-amber-400/5 p-3 mt-4">
      <div className="font-mono text-xs text-amber-400 uppercase tracking-wider mb-2">
        Postmortem pending
      </div>
      <p className="font-mono text-xs text-muted-foreground mb-3">
        Add the root cause now that you have it. The artifact will be regenerated.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder="Describe the root cause you discovered..."
        className="w-full bg-card border border-border px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors resize-none"
      />
      <button
        onClick={save}
        disabled={saving}
        className="mt-2 flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground font-mono text-xs uppercase tracking-wider hover:bg-primary/90 transition-all disabled:opacity-50"
      >
        {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving</> : 'Save root cause'}
      </button>
    </div>
  );
}
