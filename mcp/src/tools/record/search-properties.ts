/**
 * Tool: search_properties
 * Search/filter properties with various criteria
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  state: z.string().optional().describe('State code (e.g., TX, CA)'),
  city: z.string().optional().describe('City name (partial match)'),
  facility_name: z.string().optional().describe('Facility name (partial match)'),
  owner_company_id: z.number().optional().describe('Filter by owner company ID'),
  operator_company_id: z.number().optional().describe('Filter by operator company ID'),
  limit: z.number().min(1).max(100).default(25).describe('Maximum results (default 25, max 100)')
});

export type SearchPropertiesParams = z.infer<typeof schema>;

interface PropertyRow extends RowDataPacket {
  id: number;
  ccn: string;
  facility_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  owner_company: string | null;
  operator_company: string | null;
}

export async function execute(params: SearchPropertiesParams): Promise<ToolResult> {
  const { state, city, facility_name, owner_company_id, operator_company_id, limit = 25 } = params;

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (state) {
    conditions.push('pm.state = ?');
    values.push(state.toUpperCase());
  }

  if (city) {
    conditions.push('pm.city LIKE ?');
    values.push(`%${city}%`);
  }

  if (facility_name) {
    conditions.push('pm.facility_name LIKE ?');
    values.push(`%${facility_name}%`);
  }

  if (owner_company_id) {
    conditions.push(`EXISTS (
      SELECT 1 FROM property_entity_relationships per_o
      JOIN entities e_o ON e_o.id = per_o.entity_id
      WHERE per_o.property_master_id = pm.id
        AND per_o.relationship_type = 'property_owner'
        AND e_o.company_id = ?
    )`);
    values.push(owner_company_id);
  }

  if (operator_company_id) {
    conditions.push(`EXISTS (
      SELECT 1 FROM property_entity_relationships per_op
      JOIN entities e_op ON e_op.id = per_op.entity_id
      WHERE per_op.property_master_id = pm.id
        AND per_op.relationship_type = 'facility_operator'
        AND e_op.company_id = ?
    )`);
    values.push(operator_company_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit);

  const properties = await query<PropertyRow[]>(`
    SELECT pm.id, pm.ccn, pm.facility_name, pm.address, pm.city, pm.state, pm.zip,
           c_own.company_name as owner_company,
           c_op.company_name as operator_company
    FROM property_master pm
    LEFT JOIN property_entity_relationships per_own ON per_own.property_master_id = pm.id
      AND per_own.relationship_type = 'property_owner'
    LEFT JOIN entities e_own ON e_own.id = per_own.entity_id
    LEFT JOIN companies c_own ON c_own.id = e_own.company_id AND c_own.company_name NOT LIKE '[MERGED]%'
    LEFT JOIN property_entity_relationships per_op ON per_op.property_master_id = pm.id
      AND per_op.relationship_type = 'facility_operator'
    LEFT JOIN entities e_op ON e_op.id = per_op.entity_id
    LEFT JOIN companies c_op ON c_op.id = e_op.company_id AND c_op.company_name NOT LIKE '[MERGED]%'
    ${whereClause}
    ORDER BY pm.state, pm.city, pm.facility_name
    LIMIT ?
  `, values);

  return success({
    count: properties.length,
    properties: properties.map(p => ({
      id: p.id,
      ccn: p.ccn,
      facility_name: p.facility_name,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      owner_company: p.owner_company,
      operator_company: p.operator_company
    }))
  });
}

export const definition = {
  name: 'search_properties',
  description: 'Search SNF properties by state, city, facility name, or owner/operator company. Returns up to 100 results.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'State code (e.g., TX, CA)' },
      city: { type: 'string', description: 'City name (partial match)' },
      facility_name: { type: 'string', description: 'Facility name (partial match)' },
      owner_company_id: { type: 'number', description: 'Filter by owner company ID' },
      operator_company_id: { type: 'number', description: 'Filter by operator company ID' },
      limit: { type: 'number', description: 'Maximum results (default 25, max 100)' }
    }
  }
};
