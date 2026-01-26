/**
 * Tool: sec_company_lookup
 * Find SEC CIK by company name or ticker symbol
 */
import { z } from 'zod';
import { success, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import {
  searchCompanies,
  getSubmissions,
  lookupByTicker,
  extractCompanyInfo,
  padCik,
} from './utils/sec-client.js';

export const schema = z.object({
  name: z.string().optional().describe('Company name to search'),
  ticker: z.string().optional().describe('Stock ticker symbol (e.g., OHI, SBRA, WELL)'),
});

export type SecCompanyLookupParams = z.infer<typeof schema>;

export async function execute(params: SecCompanyLookupParams): Promise<ToolResult> {
  const { name, ticker } = params;

  if (!name && !ticker) {
    return clientError('Either name or ticker is required');
  }

  try {
    // If ticker provided, do direct lookup
    if (ticker) {
      const submissions = await lookupByTicker(ticker);

      if (!submissions) {
        return success({
          found: false,
          message: `No SEC-registered company found with ticker: ${ticker}`,
          query: { ticker },
        });
      }

      const companyInfo = extractCompanyInfo(submissions);

      return success({
        found: true,
        company: companyInfo,
        recent_filings_count: submissions.filings.recent.accessionNumber.length,
        note: 'Use sec_get_filings with this CIK to retrieve filing details',
      });
    }

    // Otherwise search by name
    const results = await searchCompanies(name!);

    if (results.length === 0) {
      return success({
        found: false,
        message: `No SEC-registered companies found matching: ${name}`,
        query: { name },
      });
    }

    // If single result, get full details
    if (results.length === 1) {
      const submissions = await getSubmissions(results[0].cik);
      const companyInfo = extractCompanyInfo(submissions);

      return success({
        found: true,
        company: companyInfo,
        recent_filings_count: submissions.filings.recent.accessionNumber.length,
        note: 'Use sec_get_filings with this CIK to retrieve filing details',
      });
    }

    // Multiple results - return list for user to choose
    return success({
      found: true,
      multiple_matches: true,
      count: results.length,
      companies: results.map(r => ({
        cik: r.cik,
        name: r.name,
        tickers: r.tickers,
      })),
      note: 'Multiple companies found. Use sec_get_filings with specific CIK for details.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return clientError(`SEC API error: ${message}`);
  }
}

export const definition = {
  name: 'sec_company_lookup',
  description: 'Find SEC CIK by company name or ticker symbol. Use this to identify publicly traded companies (REITs like OHI, SBRA, WELL, CTRE, LTC) and get their Central Index Key for further SEC filings lookup.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Company name to search' },
      ticker: { type: 'string', description: 'Stock ticker symbol (e.g., OHI, SBRA, WELL)' },
    },
  },
};
