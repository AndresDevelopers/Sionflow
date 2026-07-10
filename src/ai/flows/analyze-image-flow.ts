/**
 * @deprecated Do NOT import this from client components.
 * Image description must go through POST /api/analyze-image (plain HTTP).
 * Calling this as a Server Action causes UnrecognizedActionError after HMR.
 *
 * Server-only helper kept for any legacy server-side imports.
 * Prefer: import { describeImage } from '@/lib/vision'
 */
import 'server-only';
import { z } from 'zod';
import { describeImage } from '@/lib/vision';

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
  const result = await describeImage(validatedInput.imageData);
  return AnalyzeImageOutputSchema.parse(result);
}
