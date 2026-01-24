/**
 * Tool: get_portfolio
 * Get all properties owned/operated by a company
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  company_id: z.number().describe('Company ID'),
  relationship_type: z.string().optional().describe('Filter by relationship type (property_owner, facility_operator, lender)'),
  state: z.string().optional().describe('Filter by state code'),
  limit: z.number().min(1).max(500).default(100).describe('Maximum results (default 100, max 500)')
});

export type GetPortfolioParams = z.infer<typeof schema>;

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
}

interface PropertyRow extends RowDataPacket {
  property_id: number;
  ccn: string;
  facility_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  relationship_type: string;
  entity_name: string;
}

interface StatsRow extends RowDataPacket {
  total_properties: number;
  states: string;
}

export async function execute(params: GetPortfolioParams): Promise<ToolResult> {
  const { company_id, relationship_type, state, limit = 100 } = params;

  if (!company_id) {
    return missingParam('company_id');
  }

  // Get company info
  const company = await queryOne<CompanyRow>(`
    SELECT id, company_name, company_type
    FROM companies WHERE id = ? AND company_name NOT LIKE '[MERGED]%'
  `, [company_id]);

  if (!company) {
    return notFound('Company', company_id);
  }

  // Build conditions for property query
  const conditions: string[] = ['e.company_id = ?'];
  const values: (string | number)[] = [company_id];

  if (relationship_type) {
    conditions.push('per.relationship_type = ?');
    values.push(relationship_type);
  }

  if (state) {
    conditions.push('pm.state = ?');
    values.push(state.toUpperCase());
  }

  values.push(limit);

  // Get properties (following showcase-navigation.js STEP 3 pattern)
  const properties = await query<PropertyRow[]>(`
    SELECT pm.id as property_id, pm.ccn, pm.facility_name, pm.address,
           pm.city, pm.state, pm.zip,
           per.relationship_type, e.entity_name
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    JOIN entities e ON e.id = per.entity_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY pm.state, pm.city, pm.facility_name
    LIMIT ?
  `, values);

  // Get portfolio statistics
  const stats = await queryOne<StatsRow>(`
    SELECT COUNT(DISTINCT pm.id) as total_properties,
           GROUP_CONCAT(DISTINCT pm.state ORDER BY pm.state) as states
    FROM property_master pm
    JOIN property_entity_relationships per ON per.property_master_id = pm.id
    JOIN entities e ON e.id = per.entity_id
    WHERE e.company_id = ?
    ${relationship_type ? 'AND per.relationship_type = ?' : ''}
  `, relationship_type ? [company_id, relationship_type] : [company_id]);

  // Group by relationship type for summary
  const byRelType: Record<string, number> = {};
  for (const p of properties) {
    byRelType[p.relationship_type] = (byRelType[p.relationship_type] || 0) + 1;
  }

  return success({
    company: {
      id: company.id,
      name: company.company_name,
      type: company.company_type
    },
    statistics: {
      total_properties: stats?.total_properties || 0,
      states: stats?.states ? stats.states.split(',') : [],
      by_relationship_type: byRelType
    },
    properties: properties.map(p => ({
      id: p.property_id,
      ccn: p.ccn,
      facility_name: p.facility_name,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      relationship_type: p.relationship_type,
      entity_name: p.entity_name
    }))
  });
}

export const definition = {
  name: 'get_portfolio',
  description: 'Get all properties in a company portfolio, with optional filtering by relationship type (owner/operator/lender) and state. Returns property details and portfolio statistics.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'number', description: 'Company ID' },
      relationship_type: { type: 'string', description: 'Filter by relationship type (property_owner, facility_operator, lender)' },
      state: { type: 'string', description: 'Filter by state code' },
      limit: { type: 'number', description: 'Maximum results (default 100, max 500)' }
    },
    required: ['company_id']
  }
};
