import { z } from 'zod';
import { requestDeepSeekJson } from '@/lib/deepseek';
import {
  FALLBACK_ACTIVITY_SUGGESTIONS,
  normalizeActivitySuggestions,
  type SuggestedActivities,
} from '@/lib/ai-suggestions';

const SuggestActivitiesInputSchema = z.object({
  existingActivities: z.array(z.string()).describe('A list of activities that have already been organized this year.'),
});
export type SuggestActivitiesInput = z.infer<typeof SuggestActivitiesInputSchema>;

/** Lenient schema: model often returns 2–5 items; we normalize to 3. */
const SuggestedActivitiesSchema = z.object({
  spiritual: z.array(z.string()).min(1).max(8),
  temporal: z.array(z.string()).min(1).max(8),
});

export type { SuggestedActivities };

export async function suggestActivities(input: SuggestActivitiesInput): Promise<SuggestedActivities> {
  const validatedInput = SuggestActivitiesInputSchema.parse(input);

  const raw = await requestDeepSeekJson({
    schema: SuggestedActivitiesSchema,
    messages: [
      {
        role: 'system',
        content:
          'Eres un experto planificador de actividades para el Quórum de Élderes o la Sociedad de Socorro. Responde siempre en JSON válido sin texto adicional ni markdown.',
      },
      {
        role: 'user',
        content: `Actividades existentes en el año: ${JSON.stringify(validatedInput.existingActivities)}\n\nProporciona exactamente 3 sugerencias espirituales y 3 temporales para el próximo mes.\n\nFormato JSON requerido:\n{\n  "spiritual": ["actividad 1", "actividad 2", "actividad 3"],\n  "temporal": ["actividad 1", "actividad 2", "actividad 3"]\n}`,
      },
    ],
  });

  return normalizeActivitySuggestions(raw) ?? FALLBACK_ACTIVITY_SUGGESTIONS;
}
