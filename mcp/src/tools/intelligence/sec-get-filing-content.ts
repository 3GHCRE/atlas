/**
 * Tool: sec_get_filing_content
 * Extract data from a specific SEC filing
 */
import { z } from 'zod';
import { success, clientError, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import {
  getFilingDocument,
  getFilingDocumentUrl,
  padCik,
} from './utils/sec-client.js';

export const schema = z.object({
  cik: z.string().describe('Company CIK'),
  accession_number: z.string().describe('Filing accession number (e.g., 0001193125-24-012345)'),
  document: z.string().optional().describe('Document filename (defaults to primary document from filing)'),
  extract: z.enum(['summary', 'properties', 'full']).default('summary').describe('What to extract: summary (key sections), properties (property schedules), full (entire document)'),
});

export type SecGetFilingContentParams = z.infer<typeof schema>;

/**
 * Strip HTML tags and normalize whitespace
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract property-related sections from 10-K/10-Q
 */
function extractPropertySections(text: string): string[] {
  const sections: string[] = [];

  // Common patterns for property schedules in REIT filings
  const patterns = [
    /property\s+portfolio[:\s]/i,
    /schedule\s+of\s+(?:real\s+estate\s+)?(?:properties|investments)/i,
    /real\s+estate\s+properties/i,
    /facilities?\s+(?:owned|operated|leased)/i,
    /tenant\s+(?:information|concentration)/i,
    /lease\s+(?:expirations?|information)/i,
    /skilled\s+nursing\s+facilities?/i,
    /senior\s+(?:housing|living)/i,
    /healthcare\s+(?:facilities?|properties?)/i,
  ];

  // Find sections containing property information
  for (const pattern of patterns) {
    const match = text.match(new RegExp(`.{0,500}${pattern.source}.{0,2000}`, 'gi'));
    if (match) {
      sections.push(...match);
    }
  }

  return [...new Set(sections)]; // Deduplicate
}

/**
 * Extract key metrics from 10-K summary
 */
function extractKeyMetrics(text: string): Record<string, string> {
  const metrics: Record<string, string> = {};

  // Common patterns for REIT metrics
  const patterns = [
    { key: 'total_properties', pattern: /(\d{1,4})\s*(?:properties|facilities|communities)/i },
    { key: 'total_beds', pattern: /(\d{1,6})\s*(?:beds|units)/i },
    { key: 'states', pattern: /(\d{1,2})\s*states/i },
    { key: 'occupancy', pattern: /occupancy[:\s]+(\d{1,3}(?:\.\d+)?)\s*%/i },
    { key: 'total_revenue', pattern: /total\s+revenue[:\s]+\$?([\d,\.]+)\s*(?:million|billion)?/i },
    { key: 'noi', pattern: /net\s+operating\s+income[:\s]+\$?([\d,\.]+)/i },
  ];

  for (const { key, pattern } of patterns) {
    const match = text.match(pattern);
    if (match) {
      metrics[key] = match[1];
    }
  }

  return metrics;
}

/**
 * Extract operator names mentioned in filing
 */
function extractOperatorNames(text: string): string[] {
  const operators: string[] = [];

  // Common patterns for operator mentions
  const patterns = [
    /operated\s+by\s+([A-Z][A-Za-z\s&,]+?)(?:\.|,|\s+and\s+|\s+who)/g,
    /([A-Z][A-Za-z\s&]+?)\s+(?:operates?|manages?)\s+(?:the\s+)?(?:facilit|propert)/g,
    /lease[ds]?\s+to\s+([A-Z][A-Za-z\s&,]+?)(?:\.|,|\s+and\s+)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length > 3 && name.length < 100) {
        operators.push(name);
      }
    }
  }

  return [...new Set(operators)].slice(0, 50);
}

export async function execute(params: SecGetFilingContentParams): Promise<ToolResult> {
  const { cik, accession_number, document, extract = 'summary' } = params;

  if (!cik) {
    return missingParam('cik');
  }

  if (!accession_number) {
    return missingParam('accession_number');
  }

  try {
    // Default to the primary document (usually ends in .htm)
    const docName = document || `${padCik(cik)}-${accession_number.split('-').pop()}.htm`;

    // Try common document patterns if no document specified
    let content: string;
    let actualDoc = docName;

    try {
      content = await getFilingDocument(cik, accession_number, docName);
    } catch {
      // Try alternative naming patterns
      const alternatives = [
        'primary_doc.htm',
        `d${accession_number.split('-')[2]}.htm`,
        'form10k.htm',
        'form10q.htm',
      ];

      let found = false;
      for (const alt of alternatives) {
        try {
          content = await getFilingDocument(cik, accession_number, alt);
          actualDoc = alt;
          found = true;
          break;
        } catch {
          continue;
        }
      }

      if (!found) {
        return clientError(
          `Could not locate filing document. Try specifying the document parameter. ` +
          `Filing URL base: ${getFilingDocumentUrl(cik, accession_number, '')}`
        );
      }
    }

    // Process based on extraction type
    const plainText = stripHtml(content!);

    if (extract === 'full') {
      // Return truncated full text
      const maxLength = 50000;
      return success({
        cik: padCik(cik),
        accession_number,
        document: actualDoc,
        url: getFilingDocumentUrl(cik, accession_number, actualDoc),
        content_length: plainText.length,
        content: plainText.slice(0, maxLength),
        truncated: plainText.length > maxLength,
      });
    }

    if (extract === 'properties') {
      const propertySections = extractPropertySections(plainText);
      const operators = extractOperatorNames(plainText);

      return success({
        cik: padCik(cik),
        accession_number,
        document: actualDoc,
        url: getFilingDocumentUrl(cik, accession_number, actualDoc),
        property_sections: propertySections.slice(0, 10),
        operators_mentioned: operators,
        note: 'Property sections extracted from filing. May require manual review for complete property list.',
      });
    }

    // Default: summary
    const metrics = extractKeyMetrics(plainText);
    const operators = extractOperatorNames(plainText);
    const propertySections = extractPropertySections(plainText);

    return success({
      cik: padCik(cik),
      accession_number,
      document: actualDoc,
      url: getFilingDocumentUrl(cik, accession_number, actualDoc),
      content_length: plainText.length,
      key_metrics: Object.keys(metrics).length > 0 ? metrics : 'No standard metrics found',
      operators_mentioned: operators.length > 0 ? operators.slice(0, 20) : 'None identified',
      property_sections_found: propertySections.length,
      sample_property_section: propertySections[0]?.slice(0, 1000) || 'No property sections identified',
      note: 'Use extract="properties" for detailed property extraction or extract="full" for complete document.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return clientError(`SEC document fetch error: ${message}`);
  }
}

export const definition = {
  name: 'sec_get_filing_content',
  description: 'Extract data from a specific SEC filing. Parse 10-K/10-Q documents for property lists, operator names, and key metrics. Use extract="properties" for property schedules or extract="summary" for overview.',
  inputSchema: {
    type: 'object',
    properties: {
      cik: { type: 'string', description: 'Company CIK' },
      accession_number: { type: 'string', description: 'Filing accession number (e.g., 0001193125-24-012345)' },
      document: { type: 'string', description: 'Document filename (optional, auto-detected)' },
      extract: { type: 'string', enum: ['summary', 'properties', 'full'], description: 'What to extract: summary, properties, or full document' },
    },
    required: ['cik', 'accession_number'],
  },
};
