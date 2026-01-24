/**
 * Tool: search_companies
 * Search/filter companies with various criteria
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  name: z.string().optional().describe('Company name (partial match)'),
  type: z.string().optional().describe('Company type (opco, propco, management, holding, pe_firm, reit)'),
  state: z.string().optional().describe('State code for headquarters'),
  min_properties: z.number().optional().describe('Minimum property count'),
  limit: z.number().min(1).max(100).default(25).describe('Maximum results (default 25, max 100)')
});

export type SearchCompaniesParams = z.infer<typeof schema>;

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
  dba_name: string | null;
  state: string | null;
  entity_count: number;
  property_count: number;
}

export async function execute(params: SearchCompaniesParams): Promise<ToolResult> {
  const { name, type, state, min_properties, limit = 25 } = params;

  const conditions: string[] = ["c.company_name NOT LIKE '[MERGED]%'"];
  const values: (string | number)[] = [];

  if (name) {
    conditions.push('c.company_name LIKE ?');
    values.push(`%${name}%`);
  }

  if (type) {
    conditions.push('c.company_type = ?');
    values.push(type);
  }

  if (state) {
    conditions.push('c.state = ?');
    values.push(state.toUpperCase());
  }

  const havingClause = min_properties ? `HAVING property_count >= ${min_properties}` : '';

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit);

  const companies = await query<CompanyRow[]>(`
    SELECT c.id, c.company_name, c.company_type, c.dba_name, c.state,
           COUNT(DISTINCT e.id) as entity_count,
           COUNT(DISTINCT per.property_master_id) as property_count
    FROM companies c
    LEFT JOIN entities e ON e.company_id = c.id
    LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
    ${whereClause}
    GROUP BY c.id, c.company_name, c.company_type, c.dba_name, c.state
    ${havingClause}
    ORDER BY property_count DESC, c.company_name
    LIMIT ?
  `, values);

  return success({
    count: companies.length,
    companies: companies.map(c => ({
      id: c.id,
      name: c.company_name,
      type: c.company_type,
      dba_name: c.dba_name,
      state: c.state,
      entity_count: c.entity_count,
      property_count: c.property_count
    }))
  });
}

export const definition = {
  name: 'search_companies',
  description: 'Search portfolio companies by name, type (opco/propco/reit/etc), state, or minimum property count. Returns company statistics.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Company name (partial match)' },
      type: { type: 'string', description: 'Company type (opco, propco, management, holding, pe_firm, reit)' },
      state: { type: 'string', description: 'State code for headquarters' },
      min_properties: { type: 'number', description: 'Minimum property count' },
      limit: { type: 'number', description: 'Maximum results (default 25, max 100)' }
    }
  }
};
