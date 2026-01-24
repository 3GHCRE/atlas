/**
 * Tool: search_principals
 * Search/filter principals with various criteria
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  name: z.string().optional().describe('Principal name (partial match)'),
  company_id: z.number().optional().describe('Filter by company ID'),
  role: z.string().optional().describe('Filter by role (ceo, president, owner, director, etc.)'),
  state: z.string().optional().describe('State code'),
  limit: z.number().min(1).max(100).default(25).describe('Maximum results (default 25, max 100)')
});

export type SearchPrincipalsParams = z.infer<typeof schema>;

interface PrincipalRow extends RowDataPacket {
  id: number;
  full_name: string;
  title: string | null;
  city: string | null;
  state: string | null;
  company_count: number;
  entity_count: number;
}

export async function execute(params: SearchPrincipalsParams): Promise<ToolResult> {
  const { name, company_id, role, state, limit = 25 } = params;

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (name) {
    conditions.push('p.full_name LIKE ?');
    values.push(`%${name}%`);
  }

  if (state) {
    conditions.push('p.state = ?');
    values.push(state.toUpperCase());
  }

  if (company_id) {
    conditions.push(`EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = p.id AND pcr.company_id = ? AND pcr.end_date IS NULL
    )`);
    values.push(company_id);
  }

  if (role) {
    conditions.push(`EXISTS (
      SELECT 1 FROM principal_company_relationships pcr
      WHERE pcr.principal_id = p.id AND pcr.role = ? AND pcr.end_date IS NULL
    )`);
    values.push(role);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit);

  const principals = await query<PrincipalRow[]>(`
    SELECT p.id, p.full_name, p.title, p.city, p.state,
           COUNT(DISTINCT pcr.company_id) as company_count,
           COUNT(DISTINCT per.entity_id) as entity_count
    FROM principals p
    LEFT JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
    LEFT JOIN principal_entity_relationships per ON per.principal_id = p.id AND per.end_date IS NULL
    ${whereClause}
    GROUP BY p.id, p.full_name, p.title, p.city, p.state
    ORDER BY company_count DESC, entity_count DESC, p.full_name
    LIMIT ?
  `, values);

  return success({
    count: principals.length,
    principals: principals.map(p => ({
      id: p.id,
      name: p.full_name,
      title: p.title,
      city: p.city,
      state: p.state,
      company_count: p.company_count,
      entity_count: p.entity_count
    }))
  });
}

export const definition = {
  name: 'search_principals',
  description: 'Search individuals (owners, officers, directors) by name, company, role, or state. Returns relationship counts.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Principal name (partial match)' },
      company_id: { type: 'number', description: 'Filter by company ID' },
      role: { type: 'string', description: 'Filter by role (ceo, president, owner, director, etc.)' },
      state: { type: 'string', description: 'State code' },
      limit: { type: 'number', description: 'Maximum results (default 25, max 100)' }
    }
  }
};
