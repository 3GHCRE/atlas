/**
 * Tool: get_entity
 * Get entity by ID with company and principal relationships
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  id: z.number().describe('Entity ID')
});

export type GetEntityParams = z.infer<typeof schema>;

interface EntityRow extends RowDataPacket {
  id: number;
  entity_name: string;
  entity_type: string | null;
  company_id: number;
  company_name: string;
  company_type: string | null;
  dba_name: string | null;
  ein: string | null;
  cms_associate_id: string | null;
  state_of_incorp: string | null;
}

interface PropertyRow extends RowDataPacket {
  property_id: number;
  ccn: string;
  facility_name: string;
  city: string;
  state: string;
  relationship_type: string;
}

interface PrincipalRow extends RowDataPacket {
  principal_id: number;
  full_name: string;
  role: string;
  ownership_percentage: number | null;
}

export async function execute(params: GetEntityParams): Promise<ToolResult> {
  const { id } = params;

  if (!id) {
    return missingParam('id');
  }

  // Get entity with company info
  const entity = await queryOne<EntityRow>(`
    SELECT e.id, e.entity_name, e.entity_type, e.company_id,
           c.company_name, c.company_type,
           e.dba_name, e.ein, e.cms_associate_id, e.state_of_incorp
    FROM entities e
    JOIN companies c ON c.id = e.company_id
    WHERE e.id = ?
  `, [id]);

  if (!entity) {
    return notFound('Entity', id);
  }

  // Get properties this entity is related to
  const properties = await query<PropertyRow[]>(`
    SELECT pm.id as property_id, pm.ccn, pm.facility_name, pm.city, pm.state,
           per.relationship_type
    FROM property_entity_relationships per
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE per.entity_id = ?
    ORDER BY pm.state, pm.city
  `, [id]);

  // Get principals linked to this entity
  const principals = await query<PrincipalRow[]>(`
    SELECT p.id as principal_id, p.full_name, per.role, per.ownership_percentage
    FROM principal_entity_relationships per
    JOIN principals p ON p.id = per.principal_id
    WHERE per.entity_id = ?
      AND per.end_date IS NULL
    ORDER BY per.ownership_percentage DESC, p.full_name
  `, [id]);

  return success({
    entity: {
      id: entity.id,
      name: entity.entity_name,
      type: entity.entity_type,
      dba_name: entity.dba_name,
      ein: entity.ein,
      cms_associate_id: entity.cms_associate_id,
      state_of_incorp: entity.state_of_incorp
    },
    company: {
      id: entity.company_id,
      name: entity.company_name,
      type: entity.company_type
    },
    properties: properties.map(p => ({
      id: p.property_id,
      ccn: p.ccn,
      facility_name: p.facility_name,
      city: p.city,
      state: p.state,
      relationship_type: p.relationship_type
    })),
    principals: principals.map(p => ({
      id: p.principal_id,
      name: p.full_name,
      role: p.role,
      ownership_percentage: p.ownership_percentage
    }))
  });
}

export const definition = {
  name: 'get_entity',
  description: 'Get legal entity (LLC, Corp) details by ID, including parent company, properties, and principal relationships',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Entity ID' }
    },
    required: ['id']
  }
};
