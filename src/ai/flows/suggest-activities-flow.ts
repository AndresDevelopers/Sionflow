'use server';

import { z } from 'zod';
import { requestDeepSeekJson } from '@/lib/deepseek';

const SuggestActivitiesInputSchema = z.object({
  existingActivities: z.array(z.string()).describe('A list of activities that have already been organized this year.'),
});
export type SuggestActivitiesInput = z.infer<typeof SuggestActivitiesInputSchema>;

const SuggestedActivitiesSchema = z.object({
  spiritual: z.array(z.string()).length(3).describe('A list of 3 spiritual activity suggestions.'),
  temporal: z.array(z.string()).length(3).describe('A list of 3 temporal (social, service, etc.) activity suggestions.'),
});
export type SuggestedActivities = z.infer<typeof SuggestedActivitiesSchema>;

export async function suggestActivities(input: SuggestActivitiesInput): Promise<SuggestedActivities> {
  const validatedInput = SuggestActivitiesInputSchema.parse(input);

  return requestDeepSeekJson({
    schema: SuggestedActivitiesSchema,
    messages: [
      {
        role: 'system',
        content:
          'Eres un experto planificador de actividades para el Quórum de Élderes. Responde siempre en JSON válido sin texto adicional.',
      },
      {
        role: 'user',
        content: `Actividades existentes en el año: ${JSON.stringify(validatedInput.existingActivities)}\n\nProporciona exactamente 3 sugerencias espirituales y 3 temporales para el próximo mes.\n\nFormato JSON requerido:\n{\n  "spiritual": ["actividad 1", "actividad 2", "actividad 3"],\n  "temporal": ["actividad 1", "actividad 2", "actividad 3"]\n}`,
      },
    ],
  });
}
