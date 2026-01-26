/**
 * Tool: sec_get_filings
 * Get 10-K/10-Q filings for a company by CIK
 */
import { z } from 'zod';
import { success, clientError, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import {
  getSubmissions,
  getFilings,
  getFilingDocumentUrl,
  extractCompanyInfo,
  padCik,
} from './utils/sec-client.js';

export const schema = z.object({
  cik: z.string().describe('10-digit CIK (with leading zeros) or raw CIK number'),
  form_type: z.string().optional().describe('Filter by form type (10-K, 10-Q, 8-K)'),
  limit: z.number().min(1).max(50).default(10).describe('Max filings to return (default 10, max 50)'),
});

export type SecGetFilingsParams = z.infer<typeof schema>;

export async function execute(params: SecGetFilingsParams): Promise<ToolResult> {
  const { cik, form_type, limit = 10 } = params;

  if (!cik) {
    return missingParam('cik');
  }

  try {
    // Get company submissions
    const submissions = await getSubmissions(cik);
    const companyInfo = extractCompanyInfo(submissions);

    // Get filtered filings
    const filings = await getFilings(cik, form_type, limit);

    // Add document URLs to filings
    const filingsWithUrls = filings.map(f => ({
      ...f,
      documentUrl: getFilingDocumentUrl(cik, f.accessionNumber, f.primaryDocument),
    }));

    return success({
      company: companyInfo,
      query: {
        cik: padCik(cik),
        form_type: form_type || 'all',
        limit,
      },
      filings_count: filingsWithUrls.length,
      filings: filingsWithUrls,
      note: form_type
        ? `Showing ${form_type} filings. Use sec_get_filing_content to extract property data.`
        : 'Use form_type parameter to filter (10-K for annual, 10-Q for quarterly). Use sec_get_filing_content to extract property data.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Check for not found error
    if (message.includes('404')) {
      return clientError(`Company not found with CIK: ${cik}`);
    }

    return clientError(`SEC API error: ${message}`);
  }
}

export const definition = {
  name: 'sec_get_filings',
  description: 'Get 10-K/10-Q filings for a company by CIK. Returns filing dates, accession numbers, and links to documents. Use form_type to filter by 10-K (annual) or 10-Q (quarterly) reports.',
  inputSchema: {
    type: 'object',
    properties: {
      cik: { type: 'string', description: '10-digit CIK (with leading zeros) or raw CIK number' },
      form_type: { type: 'string', description: 'Filter by form type (10-K, 10-Q, 8-K)' },
      limit: { type: 'number', description: 'Max filings to return (default 10, max 50)' },
    },
    required: ['cik'],
  },
};
