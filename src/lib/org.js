// G1 — current-user org resolver. Single-org-per-user in V1.
// Reads from org_members via the supabase client carrying the user's JWT;
// RLS on org_members guarantees only the user's own membership rows surface.
import { base44 } from '@/api/base44Client';

let cached = null;
let inFlight = null;

export async function getCurrentOrgId() {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const { data: { user } } = await base44.supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await base44.supabase
      .from('org_members')
      .select('org_id, joined_at')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1);
    if (error) {
      console.error('getCurrentOrgId failed', error);
      return null;
    }
    cached = data?.[0]?.org_id ?? null;
    return cached;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function clearOrgCache() {
  cached = null;
}
