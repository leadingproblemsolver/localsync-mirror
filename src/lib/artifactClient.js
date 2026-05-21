import { base44 } from '@/api/base44Client';

export async function getArtifactByIncidentId(incidentId) {
  try {
    const artifacts = await base44.entities.Artifact.filter({ incident_id: incidentId });
    if (artifacts && artifacts.length > 0) {
      return artifacts[0];
    }
    return null;
  } catch (error) {
    console.error('Error fetching artifact:', error);
    return null;
  }
}
