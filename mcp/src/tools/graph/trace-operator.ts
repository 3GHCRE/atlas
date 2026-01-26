/**
 * Tool: trace_operator
 * Trace facility operations chain: Property → OpCo → Operating Company → Principals
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Internal property_master ID'),
  ccn: z.string().optional().describe('CMS Certification Number (6-digit)'),
  reapi_property_id: z.number().optional().describe('REAPI Property ID'),
  include_all_principals: z.boolean().optional().describe('Include all principals (default: false, only officers/decision makers)')
}).refine(data => data.property_id || data.ccn || data.reapi_property_id, {
  message: 'Either property_id, ccn, or reapi_property_id must be provided'
});

// Role categories in principal_company_relationships that indicate decision-making authority
// pcr.role values: 'officer', 'owner', 'director', 'manager', 'managing_employee', 'other'
// We filter for 'officer' and 'owner' to get corporate-level decision makers
const DECISION_MAKER_ROLES = ['officer', 'owner'];

export type TraceOperatorParams = z.infer<typeof schema>;

interface PropertyRow extends RowDataPacket {
  id: number;
  ccn: string;
  reapi_property_id: number | null;
  facility_name: string;
  city: string;
  state: string;
}

interface OperatorEntityRow extends RowDataPacket {
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

export async function execute(params: TraceOperatorParams): Promise<ToolResult> {
  const { property_id, ccn, reapi_property_id, include_all_principals = false } = params;

  if (!property_id && !ccn && !reapi_property_id) {
    return clientError('Either property_id, ccn, or reapi_property_id must be provided');
  }

  // Build role filter for company-level principals (officers/decision makers)
  const roleList = DECISION_MAKER_ROLES.map(r => `'${r}'`).join(',');
  const companyPrincipalFilter = include_all_principals
    ? ''
    : `AND pcr.role IN (${roleList})`;

  // Get property by whichever ID was provided
  let property: PropertyRow | null;
  if (property_id) {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, reapi_property_id, facility_name, city, state FROM property_master WHERE id = ?`,
      [property_id]
    );
  } else if (ccn) {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, reapi_property_id, facility_name, city, state FROM property_master WHERE ccn = ?`,
      [ccn]
    );
  } else {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, reapi_property_id, facility_name, city, state FROM property_master WHERE reapi_property_id = ?`,
      [reapi_property_id]
    );
  }

  if (!property) {
    return notFound('Property', property_id || ccn || reapi_property_id || '');
  }

  // Get operator entities (facility_operator relationship type)
  const operatorEntities = await query<OperatorEntityRow[]>(`
    SELECT e.id as entity_id, e.entity_name, e.entity_type,
           c.id as company_id, c.company_name, c.company_type,
           per.relationship_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.property_master_id = ?
      AND per.relationship_type = 'facility_operator'
      AND c.company_name NOT LIKE '[MERGED]%'
  `, [property.id]);

  // Get company-level principals for each operator company
  // trace_operator focuses on operations: Property → OpCo → Operating Company → Company Officers
  const principalsByCompany: Record<number, PrincipalRow[]> = {};

  for (const operatorEntity of operatorEntities) {
    // Only get company-level principals (corporate officers of the operating company)
    const principals = await query<PrincipalRow[]>(`
      SELECT p.id as principal_id, p.full_name, pcr.role, pcr.ownership_percentage, 'company' as level
      FROM principal_company_relationships pcr
      JOIN principals p ON p.id = pcr.principal_id
      WHERE pcr.company_id = ?
        AND pcr.end_date IS NULL
        ${companyPrincipalFilter}
      ORDER BY p.full_name
    `, [operatorEntity.company_id]);

    principalsByCompany[operatorEntity.company_id] = principals;
  }

  return success({
    property: {
      id: property.id,
      ccn: property.ccn,
      reapi_property_id: property.reapi_property_id,
      facility_name: property.facility_name,
      city: property.city,
      state: property.state
    },
    operations_chain: operatorEntities.map(oe => ({
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
  name: 'trace_operator',
  description: 'Trace the facility operations chain: Property → OpCo (operator entity) → Operating Company → Corporate Officers. Returns company-level principals only (CEO, President, CFO, etc.) - not entity-level managers.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Internal property_master ID' },
      ccn: { type: 'string', description: 'CMS Certification Number (6-digit)' },
      reapi_property_id: { type: 'number', description: 'REAPI Property ID' },
      include_all_principals: { type: 'boolean', description: 'Include all company-level principals (default: false, only officers/decision makers)' }
    }
  }
};
