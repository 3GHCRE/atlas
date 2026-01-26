/**
 * Tool: nonprofit_search
 * Search ProPublica Nonprofit Explorer for nonprofits by name
 */
import { z } from 'zod';
import { success, clientError, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import {
  searchNonprofits,
  formatEin,
  isHealthcareRelated,
  HEALTHCARE_NTEE_CODES,
} from './utils/propublica-client.js';

export const schema = z.object({
  q: z.string().describe('Search query (organization name, city)'),
  state: z.string().optional().describe('Two-letter state code'),
  page: z.number().min(0).default(0).describe('Results page (0-indexed)'),
});

export type NonprofitSearchParams = z.infer<typeof schema>;

export async function execute(params: NonprofitSearchParams): Promise<ToolResult> {
  const { q, state, page = 0 } = params;

  if (!q) {
    return missingParam('q');
  }

  try {
    const results = await searchNonprofits(q, state, page);

    if (results.total_results === 0) {
      return success({
        found: false,
        message: `No nonprofits found matching: ${q}${state ? ` in ${state}` : ''}`,
        query: { q, state, page },
      });
    }

    // Process results with healthcare relevance flagging
    const organizations = results.organizations.map(org => ({
      ein: formatEin(org.ein),
      name: org.name,
      city: org.city,
      state: org.state,
      ntee_code: org.ntee_code,
      ntee_description: HEALTHCARE_NTEE_CODES[org.ntee_code] || HEALTHCARE_NTEE_CODES[org.ntee_code?.charAt(0)] || null,
      is_healthcare_related: isHealthcareRelated(org.ntee_code),
      subsection_code: org.subsection_code,
      revenue: org.revenue_amount,
      assets: org.asset_amount,
      income: org.income_amount,
    }));

    // Highlight healthcare-related orgs at the top
    const healthcareOrgs = organizations.filter(o => o.is_healthcare_related);
    const otherOrgs = organizations.filter(o => !o.is_healthcare_related);

    return success({
      found: true,
      total_results: results.total_results,
      page: results.cur_page,
      total_pages: results.num_pages,
      results_on_page: organizations.length,
      healthcare_related_count: healthcareOrgs.length,
      organizations: [...healthcareOrgs, ...otherOrgs],
      note: 'Use nonprofit_get_990 with EIN to get detailed 990 filings and financials.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return clientError(`ProPublica API error: ${message}`);
  }
}

export const definition = {
  name: 'nonprofit_search',
  description: 'Search ProPublica Nonprofit Explorer for nonprofits by name. Useful for finding nonprofit healthcare operators like Evangelical Lutheran Good Samaritan Society, Ascension Living, Benedictine Health System. Returns EIN for detailed 990 lookup.',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Search query (organization name, city)' },
      state: { type: 'string', description: 'Two-letter state code' },
      page: { type: 'number', description: 'Results page (0-indexed)' },
    },
    required: ['q'],
  },
};
