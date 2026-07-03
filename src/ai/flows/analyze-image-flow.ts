'use server';

import { z } from 'zod';
import { requestDeepSeekJson } from '@/lib/deepseek';

const AnalyzeImageInputSchema = z.object({
  imageData: z.string().describe('The base64 encoded image data (data:image/jpeg;base64,...).'),
});
export type AnalyzeImageInput = z.infer<typeof AnalyzeImageInputSchema>;

const AnalyzeImageOutputSchema = z.object({
  description: z.string().describe('A detailed description of the image content.'),
});
export type AnalyzeImageOutput = z.infer<typeof AnalyzeImageOutputSchema>;

export async function analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageOutput> {
  const validatedInput = AnalyzeImageInputSchema.parse(input);

  return requestDeepSeekJson({
    schema: AnalyzeImageOutputSchema,
    messages: [
      {
        role: 'system',
        content: 'Analiza imágenes y responde siempre en JSON válido sin texto adicional.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analiza la imagen y proporciona una descripción detallada en español. Formato JSON requerido: {"description":"..."}',
          },
          {
            type: 'image_url',
            image_url: { url: validatedInput.imageData },
          },
        ],
      },
    ],
  });
}
