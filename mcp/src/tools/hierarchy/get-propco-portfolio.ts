/**
 * Tool: get_propco_portfolio
 * Get PropCo entity details with parent company context and owned properties
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  entity_id: z.number().optional().describe('PropCo entity ID'),
  entity_name: z.string().optional().describe('PropCo entity name (partial match)')
}).refine(data => data.entity_id || data.entity_name, {
  message: 'Either entity_id or entity_name must be provided'
});

export type GetPropcoPortfolioParams = z.infer<typeof schema>;

interface PropcoEntityRow extends RowDataPacket {
  id: number;
  entity_name: string;
  entity_type: string;
  company_id: number;
  company_name: string;
  company_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  state_of_incorporation: string | null;
}

interface PropertyRow extends RowDataPacket {
  id: number;
  ccn: string;
  facility_name: string;
  address: string | null;
  city: string;
  state: string;
  bed_count: number | null;
  relationship_type: string;
  confidence_score: number | null;
}

interface SiblingEntityRow extends RowDataPacket {
  id: number;
  entity_name: string;
  entity_type: string;
  property_count: number;
}

interface PrincipalRow extends RowDataPacket {
  id: number;
  full_name: string;
  role: string;
  ownership_percentage: number | null;
}

export async function execute(params: GetPropcoPortfolioParams): Promise<ToolResult> {
  const { entity_id, entity_name } = params;

  let propco: PropcoEntityRow | null = null;

  if (entity_id) {
    propco = await queryOne<PropcoEntityRow>(`
      SELECT
        e.id, e.entity_name, e.entity_type,
        e.company_id, c.company_name, c.company_type,
        e.address, e.city, e.state, e.state_of_incorporation
      FROM entities e
      JOIN companies c ON c.id = e.company_id
      WHERE e.id = ? AND c.company_name NOT LIKE '[MERGED]%'
    `, [entity_id]);
  } else if (entity_name) {
    propco = await queryOne<PropcoEntityRow>(`
      SELECT
        e.id, e.entity_name, e.entity_type,
        e.company_id, c.company_name, c.company_type,
        e.address, e.city, e.state, e.state_of_incorporation
      FROM entities e
      JOIN companies c ON c.id = e.company_id
      WHERE e.entity_name LIKE ? AND c.company_name NOT LIKE '[MERGED]%'
      AND e.entity_type = 'propco'
      LIMIT 1
    `, [`%${entity_name}%`]);
  }

  if (!propco) {
    return notFound('PropCo Entity', entity_id || entity_name || '');
  }

  // Get properties owned by this PropCo
  const properties = await query<PropertyRow[]>(`
    SELECT
      pm.id, pm.ccn, pm.facility_name, pm.address, pm.city, pm.state,
      pm.bed_count, per.relationship_type, per.confidence_score
    FROM property_entity_relationships per
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE per.entity_id = ?
      AND per.end_date IS NULL
    ORDER BY pm.state, pm.city
  `, [propco.id]);

  // Get sibling PropCos (other entities under same parent company)
  const siblings = await query<SiblingEntityRow[]>(`
    SELECT
      e.id, e.entity_name, e.entity_type,
      COUNT(DISTINCT per.property_master_id) as property_count
    FROM entities e
    LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
    WHERE e.company_id = ?
      AND e.id != ?
      AND e.entity_type = 'propco'
    GROUP BY e.id, e.entity_name, e.entity_type
    ORDER BY property_count DESC
    LIMIT 20
  `, [propco.company_id, propco.id]);

  // Get principals associated with this PropCo (via entity relationships)
  const principals = await query<PrincipalRow[]>(`
    SELECT
      p.id, p.full_name, pner.role, pner.ownership_percentage
    FROM principal_entity_relationships pner
    JOIN principals p ON p.id = pner.principal_id
    WHERE pner.entity_id = ?
      AND pner.end_date IS NULL
    ORDER BY pner.ownership_percentage DESC, p.full_name
  `, [propco.id]);

  // Calculate statistics
  const stateDistribution = properties.reduce((acc: Record<string, number>, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1;
    return acc;
  }, {});

  const totalBeds = properties.reduce((sum, p) => sum + (p.bed_count || 0), 0);

  return success({
    propco: {
      id: propco.id,
      entity_name: propco.entity_name,
      entity_type: propco.entity_type,
      address: propco.address,
      city: propco.city,
      state: propco.state,
      state_of_incorporation: propco.state_of_incorporation
    },
    parent_company: {
      id: propco.company_id,
      name: propco.company_name,
      type: propco.company_type
    },
    properties: properties.map(p => ({
      id: p.id,
      ccn: p.ccn,
      facility_name: p.facility_name,
      address: p.address,
      city: p.city,
      state: p.state,
      bed_count: p.bed_count,
      relationship_type: p.relationship_type,
      confidence_score: p.confidence_score
    })),
    principals: principals.map(p => ({
      id: p.id,
      name: p.full_name,
      role: p.role,
      ownership_percentage: p.ownership_percentage
    })),
    sibling_propcos: siblings.map(s => ({
      id: s.id,
      entity_name: s.entity_name,
      property_count: s.property_count
    })),
    statistics: {
      property_count: properties.length,
      total_beds: totalBeds,
      states: Object.keys(stateDistribution).length,
      state_distribution: stateDistribution,
      sibling_count: siblings.length,
      principal_count: principals.length
    }
  });
}

export const definition = {
  name: 'get_propco_portfolio',
  description: 'Get details of a PropCo (property-holding) entity including owned properties, parent company context, sibling PropCos, and associated principals.',
  inputSchema: {
    type: 'object',
    properties: {
      entity_id: { type: 'number', description: 'PropCo entity ID' },
      entity_name: { type: 'string', description: 'PropCo entity name (partial match)' }
    }
  }
};
