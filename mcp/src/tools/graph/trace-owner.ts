/**
 * Tool: trace_owner
 * Trace full ownership chain: Property → Entity → Company → Principals
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Property ID'),
  ccn: z.string().optional().describe('CMS Certification Number')
}).refine(data => data.property_id || data.ccn, {
  message: 'Either property_id or ccn must be provided'
});

export type TraceOwnerParams = z.infer<typeof schema>;

interface PropertyRow extends RowDataPacket {
  id: number;
  ccn: string;
  facility_name: string;
  city: string;
  state: string;
}

interface OwnerEntityRow extends RowDataPacket {
  entity_id: number;
  entity_name: string;
  entity_type: string | null;
  company_id: number;
  company_name: string;
  company_type: string | null;
  relationship_type: string;
}

interface PrincipalRow extends RowDataPacket {
  principal_id: number;
  full_name: string;
  role: string;
  ownership_percentage: number | null;
  level: string;
}

export async function execute(params: TraceOwnerParams): Promise<ToolResult> {
  const { property_id, ccn } = params;

  if (!property_id && !ccn) {
    return clientError('Either property_id or ccn must be provided');
  }

  // Get property
  let property: PropertyRow | null;
  if (property_id) {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, facility_name, city, state FROM property_master WHERE id = ?`,
      [property_id]
    );
  } else {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, facility_name, city, state FROM property_master WHERE ccn = ?`,
      [ccn]
    );
  }

  if (!property) {
    return notFound('Property', property_id || ccn || '');
  }

  // Get owner entities (property_owner relationship type)
  const ownerEntities = await query<OwnerEntityRow[]>(`
    SELECT e.id as entity_id, e.entity_name, e.entity_type,
           c.id as company_id, c.company_name, c.company_type,
           per.relationship_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.property_master_id = ?
      AND per.relationship_type = 'property_owner'
      AND c.company_name NOT LIKE '[MERGED]%'
  `, [property.id]);

  // Get principals for each company (both entity-level and company-level)
  const principalsByCompany: Record<number, PrincipalRow[]> = {};

  for (const ownerEntity of ownerEntities) {
    // Entity-level principals
    const entityPrincipals = await query<PrincipalRow[]>(`
      SELECT p.id as principal_id, p.full_name, per.role, per.ownership_percentage, 'entity' as level
      FROM principal_entity_relationships per
      JOIN principals p ON p.id = per.principal_id
      WHERE per.entity_id = ?
        AND per.end_date IS NULL
      ORDER BY per.ownership_percentage DESC, p.full_name
    `, [ownerEntity.entity_id]);

    // Company-level principals
    const companyPrincipals = await query<PrincipalRow[]>(`
      SELECT p.id as principal_id, p.full_name, pcr.role, pcr.ownership_percentage, 'company' as level
      FROM principal_company_relationships pcr
      JOIN principals p ON p.id = pcr.principal_id
      WHERE pcr.company_id = ?
        AND pcr.end_date IS NULL
      ORDER BY pcr.ownership_percentage DESC, p.full_name
    `, [ownerEntity.company_id]);

    // Combine and dedupe by principal_id (prefer entity-level)
    const seen = new Set<number>();
    const combined: PrincipalRow[] = [];

    for (const p of entityPrincipals) {
      seen.add(p.principal_id);
      combined.push(p);
    }

    for (const p of companyPrincipals) {
      if (!seen.has(p.principal_id)) {
        combined.push(p);
      }
    }

    principalsByCompany[ownerEntity.company_id] = combined;
  }

  return success({
    property: {
      id: property.id,
      ccn: property.ccn,
      facility_name: property.facility_name,
      city: property.city,
      state: property.state
    },
    ownership_chain: ownerEntities.map(oe => ({
      entity: {
        id: oe.entity_id,
        name: oe.entity_name,
        type: oe.entity_type
      },
      company: {
        id: oe.company_id,
        name: oe.company_name,
        type: oe.company_type
      },
      principals: (principalsByCompany[oe.company_id] || []).map(p => ({
        id: p.principal_id,
        name: p.full_name,
        role: p.role,
        ownership_percentage: p.ownership_percentage,
        relationship_level: p.level
      }))
    }))
  });
}

export const definition = {
  name: 'trace_owner',
  description: 'Trace the full ownership chain from property to ultimate beneficial owners: Property → Owner Entity → Portfolio Company → Principal individuals',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Property ID' },
      ccn: { type: 'string', description: 'CMS Certification Number' }
    }
  }
};
