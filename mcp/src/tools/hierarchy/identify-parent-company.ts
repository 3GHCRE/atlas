/**
 * Tool: identify_parent_company
 * Pattern matching to identify parent company from entity/company name
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  entity_id: z.number().optional().describe('Entity ID to find parent for'),
  company_id: z.number().optional().describe('Company ID to find parent for'),
  name: z.string().optional().describe('Entity/company name to analyze')
}).refine(data => data.entity_id || data.company_id || data.name, {
  message: 'At least one of entity_id, company_id, or name must be provided'
});

export type IdentifyParentCompanyParams = z.infer<typeof schema>;

interface EntityRow extends RowDataPacket {
  id: number;
  entity_name: string;
  entity_type: string | null;
  company_id: number;
  company_name: string;
}

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
}

interface PotentialParentRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
  entity_count: number;
  property_count: number;
  match_score: number;
}

// Common parent company name patterns
const PARENT_INDICATORS = [
  'Group', 'Holdings', 'Capital', 'Partners', 'Investments',
  'Properties', 'Real Estate', 'Healthcare', 'Senior Living',
  'Management', 'Services', 'Corp', 'Inc', 'LLC'
];

// PropCo naming patterns (location-based)
const PROPCO_PATTERNS = [
  /^[A-Z][a-z]+ (City|County|Park|Point|View|Ridge|Hill|Lake|Bay|Beach)/,
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b.*\b(Propco|PropCo|Property|Properties|Real Estate|Realty)\b/i,
  /\bPropco\b|\bPropCo\b/i
];

function extractBaseCompanyName(name: string): string {
  // Remove common suffixes and PropCo indicators
  let baseName = name
    .replace(/\s*(LLC|Inc|Corp|Corporation|LP|LLP|Ltd|Limited)\s*$/i, '')
    .replace(/\s*(Propco|PropCo|Property|Properties|Real Estate|Realty|RE)\s*$/i, '')
    .replace(/\s*(Holdings|Group|Capital|Partners|Investments|Management)\s*$/i, '')
    .trim();

  // Remove state abbreviations at end
  baseName = baseName.replace(/\s+[A-Z]{2}\s*$/i, '').trim();

  // Remove location words
  baseName = baseName
    .replace(/\b(City|County|Park|Point|View|Ridge|Hill|Lake|Bay|Beach|North|South|East|West)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return baseName;
}

function calculateNameSimilarity(name1: string, name2: string): number {
  const base1 = extractBaseCompanyName(name1).toLowerCase();
  const base2 = extractBaseCompanyName(name2).toLowerCase();

  if (base1 === base2) return 1.0;

  // Check if one contains the other
  if (base1.includes(base2) || base2.includes(base1)) {
    return 0.8;
  }

  // Word-level matching
  const words1 = new Set(base1.split(/\s+/));
  const words2 = new Set(base2.split(/\s+/));
  const intersection = [...words1].filter(w => words2.has(w)).length;
  const union = new Set([...words1, ...words2]).size;

  return union > 0 ? intersection / union : 0;
}

export async function execute(params: IdentifyParentCompanyParams): Promise<ToolResult> {
  const { entity_id, company_id, name } = params;

  let targetName = name || '';
  let targetType = 'unknown';
  let targetId: number | null = null;
  let currentCompanyId: number | null = company_id || null;

  // Get entity details if entity_id provided
  if (entity_id) {
    const entity = await queryOne<EntityRow>(`
      SELECT e.id, e.entity_name, e.entity_type, e.company_id, c.company_name
      FROM entities e
      JOIN companies c ON c.id = e.company_id
      WHERE e.id = ?
    `, [entity_id]);

    if (!entity) return notFound('Entity', entity_id);

    targetName = entity.entity_name;
    targetType = entity.entity_type || 'unknown';
    targetId = entity.id;
    currentCompanyId = entity.company_id;
  }

  // Get company details if company_id provided
  if (company_id && !entity_id) {
    const company = await queryOne<CompanyRow>(`
      SELECT id, company_name, company_type FROM companies WHERE id = ?
    `, [company_id]);

    if (!company) return notFound('Company', company_id);

    targetName = company.company_name;
    targetType = company.company_type || 'unknown';
    targetId = company.id;
  }

  // Check if name looks like a PropCo
  const isPropcoPattern = PROPCO_PATTERNS.some(p => p.test(targetName));
  const baseName = extractBaseCompanyName(targetName);

  // Search for potential parent companies
  const searchTerms = baseName.split(/\s+/).filter(w => w.length > 2);
  if (searchTerms.length === 0) {
    return success({
      target: { name: targetName, type: targetType, id: targetId },
      is_propco_pattern: isPropcoPattern,
      parent_candidates: [],
      message: 'Unable to extract meaningful search terms from name'
    });
  }

  // Build LIKE conditions for search
  const likeConditions = searchTerms.map(() => 'c.company_name LIKE ?').join(' OR ');
  const likeValues = searchTerms.map(t => `%${t}%`);

  const potentialParents = await query<PotentialParentRow[]>(`
    SELECT
      c.id,
      c.company_name,
      c.company_type,
      COUNT(DISTINCT e.id) as entity_count,
      COUNT(DISTINCT per.property_master_id) as property_count,
      0 as match_score
    FROM companies c
    LEFT JOIN entities e ON e.company_id = c.id
    LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
    WHERE (${likeConditions})
      AND c.company_name NOT LIKE '[MERGED]%'
      AND c.id != ?
    GROUP BY c.id, c.company_name, c.company_type
    HAVING entity_count >= 2 OR property_count >= 3
    ORDER BY property_count DESC, entity_count DESC
    LIMIT 20
  `, [...likeValues, currentCompanyId || 0]);

  // Calculate match scores
  const scoredParents = potentialParents.map(p => ({
    ...p,
    match_score: calculateNameSimilarity(targetName, p.company_name),
    has_parent_indicator: PARENT_INDICATORS.some(ind =>
      p.company_name.toLowerCase().includes(ind.toLowerCase())
    )
  }));

  // Sort by match score then property count
  scoredParents.sort((a, b) => {
    if (b.match_score !== a.match_score) return b.match_score - a.match_score;
    if (b.has_parent_indicator !== a.has_parent_indicator) return b.has_parent_indicator ? 1 : -1;
    return b.property_count - a.property_count;
  });

  const topCandidates = scoredParents.slice(0, 5);

  // Determine best match
  const bestMatch = topCandidates.length > 0 && topCandidates[0].match_score >= 0.5
    ? topCandidates[0]
    : null;

  return success({
    target: {
      name: targetName,
      type: targetType,
      id: targetId,
      current_company_id: currentCompanyId
    },
    analysis: {
      is_propco_pattern: isPropcoPattern,
      extracted_base_name: baseName,
      search_terms: searchTerms
    },
    best_match: bestMatch ? {
      company_id: bestMatch.id,
      company_name: bestMatch.company_name,
      company_type: bestMatch.company_type,
      match_score: Math.round(bestMatch.match_score * 100),
      entity_count: bestMatch.entity_count,
      property_count: bestMatch.property_count,
      confidence: bestMatch.match_score >= 0.8 ? 'high' : bestMatch.match_score >= 0.6 ? 'medium' : 'low'
    } : null,
    parent_candidates: topCandidates.map(c => ({
      company_id: c.id,
      company_name: c.company_name,
      company_type: c.company_type,
      match_score: Math.round(c.match_score * 100),
      entity_count: c.entity_count,
      property_count: c.property_count
    }))
  });
}

export const definition = {
  name: 'identify_parent_company',
  description: 'Analyze an entity or company name to identify potential parent/portfolio company using pattern matching and name similarity.',
  inputSchema: {
    type: 'object',
    properties: {
      entity_id: { type: 'number', description: 'Entity ID to find parent for' },
      company_id: { type: 'number', description: 'Company ID to find parent for' },
      name: { type: 'string', description: 'Entity/company name to analyze' }
    }
  }
};
