/**
 * Tool: nonprofit_get_990
 * Get Form 990 details for a nonprofit by EIN
 */
import { z } from 'zod';
import { success, clientError, missingParam, notFound } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import {
  getOrganization,
  formatEin,
  normalizeEin,
  extractFinancials,
  isHealthcareRelated,
  HEALTHCARE_NTEE_CODES,
} from './utils/propublica-client.js';

export const schema = z.object({
  ein: z.string().describe('9-digit Employer ID Number (with or without dash)'),
});

export type NonprofitGet990Params = z.infer<typeof schema>;

export async function execute(params: NonprofitGet990Params): Promise<ToolResult> {
  const { ein } = params;

  if (!ein) {
    return missingParam('ein');
  }

  const normalizedEin = normalizeEin(ein);

  if (normalizedEin.length !== 9) {
    return clientError(`Invalid EIN format: ${ein}. EIN should be 9 digits.`);
  }

  try {
    const data = await getOrganization(ein);

    if (!data.organization) {
      return notFound('Nonprofit organization', ein);
    }

    const org = data.organization;
    const filingsWithData = org.filings_with_data || data.filings_with_data || [];
    const filingsWithoutData = org.filings_without_data || data.filings_without_data || [];
    const financials = extractFinancials(filingsWithData);

    return success({
      organization: {
        ein: formatEin(org.ein),
        name: org.name,
        address: org.address,
        city: org.city,
        state: org.state,
        zipcode: org.zipcode,
        ntee_code: org.ntee_code,
        ntee_description: HEALTHCARE_NTEE_CODES[org.ntee_code] || HEALTHCARE_NTEE_CODES[org.ntee_code?.charAt(0)] || null,
        is_healthcare_related: isHealthcareRelated(org.ntee_code),
        subsection_code: org.subsection_code,
        ruling_date: org.ruling_date,
        have_filings: org.have_filings,
        have_pdfs: org.have_pdfs,
      },
      financials: financials || {
        note: 'No financial data available in recent filings',
      },
      filings: {
        with_data: filingsWithData.slice(0, 10).map(f => ({
          tax_year: f.tax_prd_yr,
          form_type: f.formtype_str,
          total_revenue: f.totrevenue,
          total_expenses: f.totfuncexpns,
          total_assets: f.totassetsend,
          total_liabilities: f.totliabend,
          pdf_url: f.pdf_url,
        })),
        without_data_count: filingsWithoutData.length,
      },
      latest_filing: filingsWithData.length > 0 ? {
        year: filingsWithData[0].tax_prd_yr,
        revenue: filingsWithData[0].totrevenue,
        expenses: filingsWithData[0].totfuncexpns,
        assets: filingsWithData[0].totassetsend,
        liabilities: filingsWithData[0].totliabend,
        net_assets: filingsWithData[0].totassetsend - filingsWithData[0].totliabend,
        executive_comp_pct: filingsWithData[0].pct_compnsatncurrofcrs,
        pdf_url: filingsWithData[0].pdf_url,
      } : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('404')) {
      return notFound('Nonprofit organization', ein);
    }

    return clientError(`ProPublica API error: ${message}`);
  }
}

export const definition = {
  name: 'nonprofit_get_990',
  description: 'Get IRS Form 990 details for a nonprofit by EIN. Returns organization details, financial history (revenue, expenses, assets), and links to PDF filings. Useful for verifying nonprofit healthcare operators.',
  inputSchema: {
    type: 'object',
    properties: {
      ein: { type: 'string', description: '9-digit Employer ID Number (with or without dash)' },
    },
    required: ['ein'],
  },
};
