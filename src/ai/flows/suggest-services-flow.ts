import { z } from 'zod';
import { requestDeepSeekJson } from '@/lib/deepseek';
import {
  FALLBACK_SERVICE_SUGGESTIONS,
  normalizeServiceSuggestions,
  type SuggestedServices,
} from '@/lib/ai-suggestions';

const SuggestServicesInputSchema = z.object({
  existingServices: z.array(z.string()).describe('Servicios ya planificados este año.'),
  existingActivities: z
    .array(z.string())
    .describe('Actividades actuales del año para evitar duplicidad entre actividad y servicio.'),
});

export type SuggestServicesInput = z.infer<typeof SuggestServicesInputSchema>;

/** Lenient schema: model often returns 2–5 items; we normalize to 3. */
const SuggestedServicesSchema = z.object({
  quorumCare: z.array(z.string()).min(1).max(8),
  communityImpact: z.array(z.string()).min(1).max(8),
});

export type { SuggestedServices };

export async function suggestServices(input: SuggestServicesInput): Promise<SuggestedServices> {
  const validatedInput = SuggestServicesInputSchema.parse(input);

  const raw = await requestDeepSeekJson({
    schema: SuggestedServicesSchema,
    messages: [
      {
        role: 'system',
        content:
          'Eres un coordinador experto en planificación de servicio comunitario y pastoral. Responde siempre en JSON válido sin texto adicional ni markdown.',
      },
      {
        role: 'user',
        content: `Servicios existentes en el año: ${JSON.stringify(validatedInput.existingServices)}\nActividades actuales del año: ${JSON.stringify(validatedInput.existingActivities)}\n\nGenera ideas de servicio para el próximo mes evitando duplicidad y devolviendo exactamente 3 sugerencias por categoría.\n\nFormato JSON requerido:\n{\n  "quorumCare": ["...", "...", "..."],\n  "communityImpact": ["...", "...", "..."]\n}`,
      },
    ],
  });

  return normalizeServiceSuggestions(raw) ?? FALLBACK_SERVICE_SUGGESTIONS;
}
