import { timeAgo } from '@/lib/suggestions';

// V1 engineer marker: no profiles table yet, so derive a stable short
// fingerprint from the UUID. Surfaces "different user" visually without
// pretending we know names.
function loggerTag(uid) {
  if (!uid || typeof uid !== 'string') return null;
  const clean = uid.replace(/-/g, '');
  if (clean.length < 4) return null;
  return `#${clean.slice(-4)}`;
}

export default function EventTimeline({ events }) {
  const sorted = [...events].sort((a, b) => {
    if (a.step_order !== b.step_order) return a.step_order - b.step_order;
    return new Date(a.created_date).getTime() - new Date(b.created_date).getTime();
  });

  if (sorted.length === 0) {
    return (
      <div className="border border-dashed border-border p-6 text-center">
        <p className="font-mono text-xs text-muted-foreground">
          No actions logged yet. Capture your first diagnostic step below.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {sorted.map((event) => {
        const isFirst = event.step_order === 1;
        const tag = loggerTag(event.logged_by);
        return (
          <div
            key={event.id}
            className={`flex gap-4 p-4 border transition-colors ${
              isFirst
                ? 'border-primary/30 bg-primary/5'
                : 'border-border bg-card'
            }`}
          >
            {/* Step number */}
            <div className="flex-shrink-0 w-8 text-right">
              <span className={`font-mono text-xs font-medium ${
                isFirst ? 'text-primary' : 'text-muted-foreground/50'
              }`}>
                {event.step_order}
              </span>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {isFirst && (
                <div className="font-mono text-xs text-primary uppercase tracking-wider mb-1.5">
                  Initial intent
                </div>
              )}
              <p className="font-mono text-sm text-foreground leading-relaxed">
                {event.message}
              </p>
            </div>

            {/* Logger + timestamp */}
            <div className="flex-shrink-0 text-right flex flex-col items-end gap-0.5">
              <span className="font-mono text-xs text-muted-foreground/50">
                {timeAgo(event.created_date)}
              </span>
              {tag && (
                <span
                  title={`Logged by ${event.logged_by}`}
                  className="font-mono text-[10px] text-muted-foreground/40 tracking-wider"
                >
                  {tag}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
