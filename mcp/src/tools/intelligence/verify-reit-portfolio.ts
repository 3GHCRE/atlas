/**
 * Tool: verify_reit_portfolio
 * Cross-reference REIT SEC data with Atlas database
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, clientError, notFound } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';
import {
  searchCompanies,
  getSubmissions,
  getFilings,
  extractCompanyInfo,
  padCik,
  lookupByTicker,
} from './utils/sec-client.js';

export const schema = z.object({
  company_id: z.number().optional().describe('Atlas company ID'),
  company_name: z.string().optional().describe('Company name to lookup in both Atlas and SEC'),
  ticker: z.string().optional().describe('Stock ticker symbol'),
});

export type VerifyReitPortfolioParams = z.infer<typeof schema>;

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
  sec_cik: string | null;
  sec_ticker: string | null;
  is_public: boolean;
}

interface PropertyRow extends RowDataPacket {
  property_id: number;
  ccn: string;
  facility_name: string;
  city: string;
  state: string;
}

interface StatsRow extends RowDataPacket {
  total_properties: number;
  states: string;
}

// Known REIT mappings for quick lookup
const KNOWN_REITS: Record<string, { cik: string; atlasId?: number }> = {
  'OHI': { cik: '0000908311', atlasId: 14598 },
  'SBRA': { cik: '0001492298', atlasId: 14603 },
  'WELL': { cik: '0000766704', atlasId: 14599 },
  'CTRE': { cik: '0001590717', atlasId: 14601 },
  'LTC': { cik: '0000887905', atlasId: 14625 },
  'NHC': { cik: '0000810765', atlasId: 14615 },
  'VTR': { cik: '0000740260', atlasId: 15515 },
};

export async function execute(params: VerifyReitPortfolioParams): Promise<ToolResult> {
  const { company_id, company_name, ticker } = params;

  if (!company_id && !company_name && !ticker) {
    return clientError('At least one of company_id, company_name, or ticker is required');
  }

  try {
    let atlasCompany: CompanyRow | null = null;
    let secData = null;
    let cik: string | null = null;

    // Step 1: Find company in Atlas database
    if (company_id) {
      atlasCompany = await queryOne<CompanyRow>(`
        SELECT id, company_name, company_type, sec_cik, sec_ticker,
               COALESCE(is_public, FALSE) as is_public
        FROM companies
        WHERE id = ? AND company_name NOT LIKE '[MERGED]%'
      `, [company_id]);

      if (!atlasCompany) {
        return notFound('Company', company_id);
      }
    } else if (company_name) {
      atlasCompany = await queryOne<CompanyRow>(`
        SELECT id, company_name, company_type, sec_cik, sec_ticker,
               COALESCE(is_public, FALSE) as is_public
        FROM companies
        WHERE company_name LIKE ? AND company_name NOT LIKE '[MERGED]%'
        LIMIT 1
      `, [`%${company_name}%`]);
    }

    // Step 2: Look up in SEC
    if (ticker) {
      // Check known REITs first
      const knownReit = KNOWN_REITS[ticker.toUpperCase()];
      if (knownReit) {
        cik = knownReit.cik;
        const submissions = await getSubmissions(cik);
        secData = {
          ...extractCompanyInfo(submissions),
          recent_filings_count: submissions.filings.recent.accessionNumber.length,
        };

        // If no Atlas company found, try to find by known ID
        if (!atlasCompany && knownReit.atlasId) {
          atlasCompany = await queryOne<CompanyRow>(`
            SELECT id, company_name, company_type, sec_cik, sec_ticker,
                   COALESCE(is_public, FALSE) as is_public
            FROM companies WHERE id = ?
          `, [knownReit.atlasId]);
        }
      } else {
        // Search SEC
        const submissions = await lookupByTicker(ticker);
        if (submissions) {
          cik = padCik(submissions.cik);
          secData = {
            ...extractCompanyInfo(submissions),
            recent_filings_count: submissions.filings.recent.accessionNumber.length,
          };
        }
      }
    } else if (company_name && !atlasCompany?.sec_cik) {
      // Search SEC by company name
      const results = await searchCompanies(company_name);
      if (results.length > 0) {
        const submissions = await getSubmissions(results[0].cik);
        cik = padCik(results[0].cik);
        secData = {
          ...extractCompanyInfo(submissions),
          recent_filings_count: submissions.filings.recent.accessionNumber.length,
        };
      }
    } else if (atlasCompany?.sec_cik) {
      // Use stored CIK
      cik = atlasCompany.sec_cik;
      const submissions = await getSubmissions(cik);
      secData = {
        ...extractCompanyInfo(submissions),
        recent_filings_count: submissions.filings.recent.accessionNumber.length,
      };
    }

    // Step 3: Get Atlas portfolio data if company found
    let atlasPortfolio = null;
    if (atlasCompany) {
      const properties = await query<PropertyRow[]>(`
        SELECT pm.id as property_id, pm.ccn, pm.facility_name, pm.city, pm.state
        FROM property_master pm
        JOIN property_entity_relationships per ON per.property_master_id = pm.id
        JOIN entities e ON e.id = per.entity_id
        WHERE e.company_id = ?
        ORDER BY pm.state, pm.city
        LIMIT 100
      `, [atlasCompany.id]);

      const stats = await queryOne<StatsRow>(`
        SELECT COUNT(DISTINCT pm.id) as total_properties,
               GROUP_CONCAT(DISTINCT pm.state ORDER BY pm.state) as states
        FROM property_master pm
        JOIN property_entity_relationships per ON per.property_master_id = pm.id
        JOIN entities e ON e.id = per.entity_id
        WHERE e.company_id = ?
      `, [atlasCompany.id]);

      atlasPortfolio = {
        total_properties: stats?.total_properties || 0,
        states: stats?.states ? stats.states.split(',') : [],
        sample_properties: properties.map(p => ({
          id: p.property_id,
          ccn: p.ccn,
          name: p.facility_name,
          city: p.city,
          state: p.state,
        })),
      };
    }

    // Step 4: Build comparison result
    const result: Record<string, unknown> = {
      query: { company_id, company_name, ticker },
    };

    if (atlasCompany) {
      result.atlas_company = {
        id: atlasCompany.id,
        name: atlasCompany.company_name,
        type: atlasCompany.company_type,
        sec_cik: atlasCompany.sec_cik,
        sec_ticker: atlasCompany.sec_ticker,
        is_public: atlasCompany.is_public,
      };
      result.atlas_portfolio = atlasPortfolio;
    } else {
      result.atlas_company = null;
      result.atlas_note = 'Company not found in Atlas database';
    }

    if (secData) {
      result.sec_data = secData;
      result.sec_cik = cik;
    } else {
      result.sec_data = null;
      result.sec_note = 'Company not found in SEC EDGAR (may not be publicly traded)';
    }

    // Step 5: Generate verification summary
    if (atlasCompany && secData) {
      const nameMatch = atlasCompany.company_name.toLowerCase().includes(
        secData.name.toLowerCase().split(' ')[0]
      );

      result.verification = {
        name_match: nameMatch,
        atlas_property_count: atlasPortfolio?.total_properties || 0,
        atlas_states: atlasPortfolio?.states || [],
        sec_tickers: secData.tickers,
        sec_ein: secData.ein,
        cik_stored: atlasCompany.sec_cik === cik,
        recommendation: !atlasCompany.sec_cik
          ? `Consider storing CIK ${cik} in companies table for company_id ${atlasCompany.id}`
          : 'CIK already linked in Atlas',
      };
    }

    return success(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return clientError(`Verification error: ${message}`);
  }
}

export const definition = {
  name: 'verify_reit_portfolio',
  description: 'Cross-reference REIT with Atlas database. Compare SEC-reported company data against Atlas properties. Identifies discrepancies and suggests CIK linking. Useful for verifying public REITs like OHI, SBRA, WELL, CTRE, LTC.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'number', description: 'Atlas company ID' },
      company_name: { type: 'string', description: 'Company name to lookup' },
      ticker: { type: 'string', description: 'Stock ticker symbol' },
    },
  },
};
