'use server';

import { z } from 'zod';
import { requestDeepSeekJson } from '@/lib/deepseek';

const GenerateDashboardSummaryInputSchema = z.object({
  convertsCount: z.number().describe('The number of converts.'),
  futureMembersCount: z.number().describe('The number of future members.'),
  ministeringAssignmentsCount: z.number().describe('The number of ministering assignments.'),
  councilActionsCount: z.number().describe('The number of council actions.'),
  reportsSubmittedCount: z.number().describe('The number of reports submitted.'),
});
export type GenerateDashboardSummaryInput = z.infer<typeof GenerateDashboardSummaryInputSchema>;

const GenerateDashboardSummaryOutputSchema = z.object({
  summary: z.string().describe('A summary of the key statistics for the dashboard.'),
});
export type GenerateDashboardSummaryOutput = z.infer<typeof GenerateDashboardSummaryOutputSchema>;

export async function generateDashboardSummary(
  input: GenerateDashboardSummaryInput
): Promise<GenerateDashboardSummaryOutput> {
  const validatedInput = GenerateDashboardSummaryInputSchema.parse(input);

  return requestDeepSeekJson({
    schema: GenerateDashboardSummaryOutputSchema,
    messages: [
      {
        role: 'system',
        content:
          'You are a secretary of the Quorum of Elders of the Church of Jesus Christ of Latter-day Saints. Respond with valid JSON only.',
      },
      {
        role: 'user',
        content: `Generate a concise summary of key dashboard statistics:\n\nConverts Count: ${validatedInput.convertsCount}\nFuture Members Count: ${validatedInput.futureMembersCount}\nMinistering Assignments Count: ${validatedInput.ministeringAssignmentsCount}\nCouncil Actions Count: ${validatedInput.councilActionsCount}\nReports Submitted Count: ${validatedInput.reportsSubmittedCount}\n\nRequired JSON format:\n{"summary":"..."}`,
      },
    ],
  });
}
