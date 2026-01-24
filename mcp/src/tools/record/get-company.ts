/**
 * Tool: get_company
 * Get company by ID or name with entities and statistics
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  id: z.number().optional().describe('Company ID'),
  name: z.string().optional().describe('Company name (partial match)')
}).refine(data => data.id || data.name, {
  message: 'Either id or name must be provided'
});

export type GetCompanyParams = z.infer<typeof schema>;

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
  dba_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface EntityRow extends RowDataPacket {
  entity_id: number;
  entity_name: string;
  entity_type: string | null;
}

interface StatsRow extends RowDataPacket {
  entity_count: number;
  property_count: number;
  principal_count: number;
}

export async function execute(params: GetCompanyParams): Promise<ToolResult> {
  const { id, name } = params;

  if (!id && !name) {
    return clientError('Either id or name must be provided');
  }

  // Get company
  let company: CompanyRow | null;
  if (id) {
    company = await queryOne<CompanyRow>(
      `SELECT id, company_name, company_type, dba_name, address, city, state, zip
       FROM companies WHERE id = ? AND company_name NOT LIKE '[MERGED]%'`,
      [id]
    );
  } else {
    company = await queryOne<CompanyRow>(
      `SELECT id, company_name, company_type, dba_name, address, city, state, zip
       FROM companies WHERE company_name LIKE ? AND company_name NOT LIKE '[MERGED]%'
       LIMIT 1`,
      [`%${name}%`]
    );
  }

  if (!company) {
    return notFound('Company', id || name || '');
  }

  // Get entities under this company
  const entities = await query<EntityRow[]>(`
    SELECT id as entity_id, entity_name, entity_type
    FROM entities
    WHERE company_id = ?
    ORDER BY entity_name
  `, [company.id]);

  // Get statistics
  const stats = await queryOne<StatsRow>(`
    SELECT
      COUNT(DISTINCT e.id) as entity_count,
      COUNT(DISTINCT per.property_master_id) as property_count,
      COUNT(DISTINCT pcr.principal_id) as principal_count
    FROM companies c
    LEFT JOIN entities e ON e.company_id = c.id
    LEFT JOIN property_entity_relationships per ON per.entity_id = e.id
    LEFT JOIN principal_company_relationships pcr ON pcr.company_id = c.id AND pcr.end_date IS NULL
    WHERE c.id = ?
  `, [company.id]);

  return success({
    company: {
      id: company.id,
      name: company.company_name,
      type: company.company_type,
      dba_name: company.dba_name,
      address: company.address,
      city: company.city,
      state: company.state,
      zip: company.zip
    },
    entities: entities.map(e => ({
      id: e.entity_id,
      name: e.entity_name,
      type: e.entity_type
    })),
    statistics: {
      entity_count: stats?.entity_count || 0,
      property_count: stats?.property_count || 0,
      principal_count: stats?.principal_count || 0
    }
  });
}

export const definition = {
  name: 'get_company',
  description: 'Get portfolio company by ID or name, including child entities and statistics (entity count, property count, principal count)',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Company ID' },
      name: { type: 'string', description: 'Company name (partial match)' }
    }
  }
};
