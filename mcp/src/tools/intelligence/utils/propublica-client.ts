/**
 * ProPublica Nonprofit Explorer API Client
 * For accessing IRS Form 990 data
 * No documented rate limit, but we'll be respectful
 */

const PROPUBLICA_BASE = 'https://projects.propublica.org/nonprofits/api/v2';

// Rate limiting: be respectful even without documented limits
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 200; // 200ms = 5 requests/second

/**
 * Wait to respect rate limiting
 */
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();
}

/**
 * Make a rate-limited request to ProPublica API
 */
async function propublicaFetch(url: string): Promise<Response> {
  await rateLimit();

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`ProPublica API error: ${response.status} ${response.statusText}`);
  }

  return response;
}

/**
 * Search result from ProPublica
 */
export interface NonprofitSearchResult {
  ein: string;
  name: string;
  city: string;
  state: string;
  ntee_code: string;
  subsection_code: string;
  classification_codes: string;
  ruling_date: string;
  deductibility_code: string;
  foundation_code: string;
  activity_codes: string;
  organization_code: string;
  exempt_organization_status_code: string;
  tax_period: string;
  asset_code: string;
  income_code: string;
  filing_requirement_code: string;
  pf_filing_requirement_code: string;
  accounting_period: string;
  asset_amount: number;
  income_amount: number;
  revenue_amount: number;
  score: number;
}

/**
 * Organization details from ProPublica
 */
export interface NonprofitOrganization {
  id: number;
  ein: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  ntee_code: string;
  subsection_code: number;
  classification_codes: string;
  ruling_date: string;
  deductibility_code: number;
  foundation_code: number;
  activity_codes: string;
  organization_code: number;
  exempt_organization_status_code: string;
  tax_period: number;
  asset_code: number;
  income_code: number;
  filing_requirement_code: string;
  pf_filing_requirement_code: string;
  accounting_period: number;
  asset_amount: number;
  income_amount: number;
  revenue_amount: number;
  created_at: string;
  updated_at: string;
  data_source: string;
  have_filings: boolean;
  have_extracts: boolean;
  have_pdfs: boolean;
  filings_with_data: Filing990[];
  filings_without_data: FilingBasic[];
}

/**
 * 990 Filing with extracted data
 */
export interface Filing990 {
  tax_prd: number;
  tax_prd_yr: number;
  formtype: number;
  formtype_str: string;
  pdf_url: string;
  updated: string;
  totrevenue: number;
  totfuncexpns: number;
  totassetsend: number;
  totliabend: number;
  pct_compnsatncurrofcrs: number;
}

/**
 * Filing without extracted data
 */
export interface FilingBasic {
  tax_prd: number;
  tax_prd_yr: number;
  formtype: number;
  formtype_str: string;
  pdf_url: string;
}

/**
 * Search response from ProPublica
 */
export interface SearchResponse {
  total_results: number;
  organizations: NonprofitSearchResult[];
  num_pages: number;
  cur_page: number;
  per_page: number;
  page_offset: number;
  search_query: string;
  selected_state: string | null;
  selected_ntee: string | null;
  selected_code: string | null;
}

/**
 * Organization response from ProPublica
 */
export interface OrganizationResponse {
  organization: NonprofitOrganization;
  filings_with_data: Filing990[];
  filings_without_data: FilingBasic[];
}

/**
 * Format EIN with dash (XX-XXXXXXX)
 */
export function formatEin(ein: string | number): string {
  const einStr = String(ein);
  const digits = einStr.replace(/\D/g, '');
  if (digits.length !== 9) {
    return einStr;
  }
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/**
 * Normalize EIN (remove dashes and spaces)
 */
export function normalizeEin(ein: string | number): string {
  return String(ein).replace(/\D/g, '');
}

/**
 * Search for nonprofits by name
 */
export async function searchNonprofits(
  query: string,
  state?: string,
  page: number = 0
): Promise<SearchResponse> {
  let url = `${PROPUBLICA_BASE}/search.json?q=${encodeURIComponent(query)}`;

  if (state) {
    url += `&state%5Bid%5D=${state.toUpperCase()}`;
  }

  if (page > 0) {
    url += `&page=${page}`;
  }

  const response = await propublicaFetch(url);
  const data = await response.json() as SearchResponse;

  return data;
}

/**
 * Get organization details by EIN
 */
export async function getOrganization(ein: string): Promise<OrganizationResponse> {
  const normalizedEin = normalizeEin(ein);
  const url = `${PROPUBLICA_BASE}/organizations/${normalizedEin}.json`;

  const response = await propublicaFetch(url);
  const data = await response.json() as OrganizationResponse;

  return data;
}

/**
 * Extract key financial metrics from 990 data
 */
export function extractFinancials(filings: Filing990[]) {
  if (filings.length === 0) {
    return null;
  }

  // Get most recent filing
  const latest = filings.reduce((a, b) =>
    a.tax_prd_yr > b.tax_prd_yr ? a : b
  );

  // Get trend data (last 5 years)
  const trend = filings
    .sort((a, b) => b.tax_prd_yr - a.tax_prd_yr)
    .slice(0, 5)
    .map(f => ({
      year: f.tax_prd_yr,
      revenue: f.totrevenue,
      expenses: f.totfuncexpns,
      assets: f.totassetsend,
      liabilities: f.totliabend,
    }));

  return {
    latestYear: latest.tax_prd_yr,
    revenue: latest.totrevenue,
    expenses: latest.totfuncexpns,
    assets: latest.totassetsend,
    liabilities: latest.totliabend,
    netAssets: latest.totassetsend - latest.totliabend,
    executiveCompensationPct: latest.pct_compnsatncurrofcrs,
    trend,
  };
}

/**
 * NTEE code categories for healthcare/senior services
 */
export const HEALTHCARE_NTEE_CODES: Record<string, string> = {
  'E': 'Health - General and Rehabilitative',
  'E20': 'Hospitals',
  'E21': 'Community Health Systems',
  'E22': 'Hospital - General',
  'E24': 'Hospital - Specialty',
  'E30': 'Health Treatment Facilities',
  'E32': 'Community Mental Health Center',
  'E50': 'Rehabilitative Medical Services',
  'E60': 'Health Support Services',
  'E70': 'Public Health Programs',
  'E80': 'Health (General and Financing)',
  'E90': 'Nursing Services',
  'E91': 'Nursing Facilities',
  'E92': 'Home Health Care',
  'P': 'Human Services - Multipurpose and Other',
  'P70': 'Residential, Custodial Care',
  'P73': 'Group Home (Residential Care)',
  'P74': 'Hospice',
  'P75': 'Supportive Housing for Older Adults',
};

/**
 * Check if organization is healthcare/senior services related
 */
export function isHealthcareRelated(nteeCode: string): boolean {
  if (!nteeCode) return false;

  const code = nteeCode.toUpperCase();
  return (
    code.startsWith('E') || // Health
    code.startsWith('P7') || // Residential/Custodial care
    code === 'P' // Human Services
  );
}
