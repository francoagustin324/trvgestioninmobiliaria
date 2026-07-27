import { getCloudSession } from './cloud-api.js';
import type { QualificationAnalysis, QualificationSuggestion } from './lead-qualification.js';

interface CloudConfigResponse {
  leadQualificationAiConfigured?: boolean;
}

interface IntelligentResponse {
  available?: boolean;
  suggestions?: QualificationSuggestion[];
  error?: string;
}

async function optionalAiConfigured(): Promise<boolean> {
  try {
    const response = await fetch('/api/cloud-config', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return false;
    const payload = await response.json() as CloudConfigResponse;
    return Boolean(payload.leadQualificationAiConfigured);
  } catch {
    return false;
  }
}

export async function requestIntelligentQualification(
  text: string,
  deterministic: QualificationAnalysis,
): Promise<{ available: boolean; suggestions: QualificationSuggestion[]; error?: string }> {
  if (!await optionalAiConfigured()) return { available: false, suggestions: [] };
  const session = getCloudSession();
  if (!session?.accessToken) return { available: true, suggestions: [], error: 'Iniciá sesión para usar el análisis inteligente opcional.' };
  try {
    const response = await fetch('/api/lead-qualification/analyze', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.slice(0, 40_000),
        deterministic: {
          suggestions: deterministic.suggestions.map(({ field, value, confidence, ambiguous }) => ({ field, value, confidence, ambiguous })),
          missingQuestions: deterministic.missingQuestions,
        },
      }),
    });
    const payload = await response.json() as IntelligentResponse;
    return {
      available: Boolean(payload.available),
      suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
      error: payload.error,
    };
  } catch {
    return { available: true, suggestions: [], error: 'El análisis inteligente no respondió. Se mantienen las detecciones determinísticas.' };
  }
}

export function mergeQualificationSuggestions(
  deterministic: QualificationSuggestion[],
  intelligent: QualificationSuggestion[],
): QualificationSuggestion[] {
  const merged = [...deterministic];
  intelligent.forEach((candidate) => {
    const existing = merged.find((item) => item.field === candidate.field);
    if (!existing) merged.push(candidate);
    else if (candidate.confidenceScore > existing.confidenceScore && !candidate.ambiguous) merged[merged.indexOf(existing)] = candidate;
  });
  return merged;
}
