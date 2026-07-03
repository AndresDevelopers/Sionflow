'use server';

import { z } from 'zod';
import { requestDeepSeekJson } from '@/lib/deepseek';

const SuggestServicesInputSchema = z.object({
  existingServices: z.array(z.string()).describe('Servicios ya planificados este año.'),
  existingActivities: z.array(z.string()).describe('Actividades actuales del año para evitar duplicidad entre actividad y servicio.'),
});

export type SuggestServicesInput = z.infer<typeof SuggestServicesInputSchema>;

const SuggestedServicesSchema = z.object({
  quorumCare: z.array(z.string()).length(3).describe('3 sugerencias de servicio de cuidado y apoyo a hermanos/familias del quórum.'),
  communityImpact: z.array(z.string()).length(3).describe('3 sugerencias de servicio comunitario con impacto medible.'),
});

export type SuggestedServices = z.infer<typeof SuggestedServicesSchema>;

export async function suggestServices(input: SuggestServicesInput): Promise<SuggestedServices> {
  const validatedInput = SuggestServicesInputSchema.parse(input);

  return requestDeepSeekJson({
    schema: SuggestedServicesSchema,
    messages: [
      {
        role: 'system',
        content:
          'Eres un coordinador experto de servicio del Quórum de Élderes. Responde siempre en JSON válido sin texto adicional.',
      },
      {
        role: 'user',
        content: `Servicios existentes en el año: ${JSON.stringify(validatedInput.existingServices)}\nActividades actuales del año: ${JSON.stringify(validatedInput.existingActivities)}\n\nGenera ideas de servicio para el próximo mes evitando duplicidad y devolviendo exactamente 3 sugerencias por categoría.\n\nFormato JSON requerido:\n{\n  "quorumCare": ["...", "...", "..."],\n  "communityImpact": ["...", "...", "..."]\n}`,
      },
    ],
  });
}
