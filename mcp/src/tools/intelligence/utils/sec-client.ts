/**
 * SEC EDGAR API Client
 * Rate limited to 10 requests/second per SEC fair access policy
 * Requires User-Agent header with company contact info
 */

const SEC_DATA_BASE = 'https://data.sec.gov';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';

// SEC requires User-Agent header identifying the requester
const USER_AGENT = '3GHCRE Atlas malcolm@lucentre.ai';

// Rate limiting: max 10 requests per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // 100ms = 10 requests/second

// Cache for company tickers (refreshed every hour)
interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}
let tickerCache: TickerEntry[] | null = null;
let tickerCacheTime = 0;
const TICKER_CACHE_TTL = 60 * 60 * 1000; // 1 hour

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
 * Make a rate-limited request to SEC API
 */
async function secFetch(url: string): Promise<Response> {
  await rateLimit();

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`SEC API error: ${response.status} ${response.statusText}`);
  }

  return response;
}

/**
 * Load and cache company tickers from SEC
 */
async function loadTickerCache(): Promise<TickerEntry[]> {
  const now = Date.now();

  if (tickerCache && (now - tickerCacheTime) < TICKER_CACHE_TTL) {
    return tickerCache;
  }

  const response = await secFetch(SEC_TICKERS_URL);
  const data = await response.json() as Record<string, TickerEntry>;

  tickerCache = Object.values(data);
  tickerCacheTime = now;

  return tickerCache;
}

/**
 * SEC Submission data structure
 */
export interface SECSubmission {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  ein: string;
  description: string;
  website: string;
  category: string;
  fiscalYearEnd: string;
  stateOfIncorporation: string;
  stateOfIncorporationDescription: string;
  filings: {
    recent: FilingList;
    files: Array<{ name: string; filingCount: number; filingFrom: string; filingTo: string }>;
  };
}

export interface FilingList {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  act: string[];
  form: string[];
  fileNumber: string[];
  filmNumber: string[];
  items: string[];
  size: number[];
  isXBRL: number[];
  isInlineXBRL: number[];
  primaryDocument: string[];
  primaryDocDescription: string[];
}

export interface Filing {
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  form: string;
  primaryDocument: string;
  description: string;
  size: number;
}

export interface SearchResult {
  cik: string;
  name: string;
  tickers: string[];
  entityType: string;
}

export interface FullTextSearchHit {
  _id: string;
  _source: {
    cik: string;
    ticker: string[];
    company: string;
    form: string;
    filedAt: string;
    period: string;
  };
}

/**
 * Pad CIK to 10 digits with leading zeros
 */
export function padCik(cik: string | number): string {
  return String(cik).padStart(10, '0');
}

/**
 * Search for companies by name using SEC ticker list
 */
export async function searchCompanies(
  query: string
): Promise<SearchResult[]> {
  const tickers = await loadTickerCache();

  const queryUpper = query.toUpperCase();
  const results: SearchResult[] = [];

  for (const entry of tickers) {
    // Match on ticker or company name
    if (
      entry.ticker.toUpperCase() === queryUpper ||
      entry.title.toUpperCase().includes(queryUpper)
    ) {
      results.push({
        cik: padCik(entry.cik_str),
        name: entry.title,
        tickers: [entry.ticker],
        entityType: 'company',
      });

      if (results.length >= 25) break;
    }
  }

  return results;
}

/**
 * Get company submissions (including filing list) by CIK
 */
export async function getSubmissions(cik: string): Promise<SECSubmission> {
  const paddedCik = padCik(cik);
  const url = `${SEC_DATA_BASE}/submissions/CIK${paddedCik}.json`;

  const response = await secFetch(url);
  const data = await response.json() as SECSubmission;

  return data;
}

/**
 * Get filings for a company, optionally filtered by form type
 */
export async function getFilings(
  cik: string,
  formType?: string,
  limit: number = 10
): Promise<Filing[]> {
  const submissions = await getSubmissions(cik);
  const recent = submissions.filings.recent;

  const filings: Filing[] = [];

  for (let i = 0; i < recent.accessionNumber.length && filings.length < limit; i++) {
    const form = recent.form[i];

    // Filter by form type if specified
    if (formType && !form.toUpperCase().includes(formType.toUpperCase())) {
      continue;
    }

    filings.push({
      accessionNumber: recent.accessionNumber[i],
      filingDate: recent.filingDate[i],
      reportDate: recent.reportDate[i],
      form: form,
      primaryDocument: recent.primaryDocument[i],
      description: recent.primaryDocDescription[i],
      size: recent.size[i],
    });
  }

  return filings;
}

/**
 * Get the URL for a filing document
 */
export function getFilingDocumentUrl(cik: string, accessionNumber: string, document: string): string {
  const paddedCik = padCik(cik);
  // Remove dashes from accession number for URL
  const accessionNoDashes = accessionNumber.replace(/-/g, '');
  return `${SEC_ARCHIVES_BASE}/${paddedCik}/${accessionNoDashes}/${document}`;
}

/**
 * Fetch filing document content (HTML or text)
 */
export async function getFilingDocument(
  cik: string,
  accessionNumber: string,
  document: string
): Promise<string> {
  const url = getFilingDocumentUrl(cik, accessionNumber, document);
  const response = await secFetch(url);
  return response.text();
}

/**
 * Look up company by ticker symbol
 */
export async function lookupByTicker(ticker: string): Promise<SECSubmission | null> {
  const tickers = await loadTickerCache();
  const tickerUpper = ticker.toUpperCase();

  const match = tickers.find(t => t.ticker.toUpperCase() === tickerUpper);

  if (!match) {
    return null;
  }

  // Get full submission data
  return getSubmissions(padCik(match.cik_str));
}

/**
 * Extract basic company info from submissions
 */
export function extractCompanyInfo(submissions: SECSubmission) {
  return {
    cik: padCik(submissions.cik),
    name: submissions.name,
    tickers: submissions.tickers,
    exchanges: submissions.exchanges,
    ein: submissions.ein,
    sic: submissions.sic,
    sicDescription: submissions.sicDescription,
    stateOfIncorporation: submissions.stateOfIncorporation,
    fiscalYearEnd: submissions.fiscalYearEnd,
    website: submissions.website,
  };
}
