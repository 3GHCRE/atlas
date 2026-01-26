/**
 * Tool: get_parent_company_portfolio
 * Get aggregated portfolio view across all PropCos/entities under a parent company
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  company_id: z.number().describe('Parent company ID'),
  include_operator_properties: z.boolean().default(true).describe('Include properties where company entities are operators (not just owners)')
});

export type GetParentCompanyPortfolioParams = z.infer<typeof schema>;

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
}

interface EntityRow extends RowDataPacket {
  id: number;
  entity_name: string;
  entity_type: string;
  property_count: number;
  total_beds: number;
}

interface PropertyRow extends RowDataPacket {
  id: number;
  ccn: string;
  facility_name: string;
  city: string;
  state: string;
  bed_count: number | null;
  entity_id: number;
  entity_name: string;
  entity_type: string;
  relationship_type: string;
}

interface PrincipalRow extends RowDataPacket {
  id: number;
  full_name: string;
  role: string;
  ownership_percentage: number | null;
  relationship_level: string;
}

interface DealSummaryRow extends RowDataPacket {
  deal_type: string;
  deal_count: number;
  total_amount: number;
  recent_date: Date | null;
}

export async function execute(params: GetParentCompanyPortfolioParams): Promise<ToolResult> {
  const { company_id, include_operator_properties = true } = params;

  // Get company details
  const company = await queryOne<CompanyRow>(`
    SELECT id, company_name, company_type, address, city, state
    FROM companies
    WHERE id = ? AND company_name NOT LIKE '[MERGED]%'
  `, [company_id]);

  if (!company) return notFound('Company', company_id);

  // Get all entities under this company
  const entities = await query<EntityRow[]>(`
    SELECT
      e.id, e.entity_name, e.entity_type,
      COUNT(DISTINCT per.property_master_id) as property_count,
      COALESCE(SUM(pm.bed_count), 0) as total_beds
    FROM entities e
    LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
    LEFT JOIN property_master pm ON pm.id = per.property_master_id
    WHERE e.company_id = ?
    GROUP BY e.id, e.entity_name, e.entity_type
    ORDER BY e.entity_type, property_count DESC
  `, [company_id]);

  // Get all properties with relationship details
  const relationshipFilter = include_operator_properties
    ? ''
    : "AND per.relationship_type = 'property_owner'";

  const properties = await query<PropertyRow[]>(`
    SELECT
      pm.id, pm.ccn, pm.facility_name, pm.city, pm.state, pm.bed_count,
      e.id as entity_id, e.entity_name, e.entity_type,
      per.relationship_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN property_master pm ON pm.id = per.property_master_id
    WHERE e.company_id = ?
      AND per.end_date IS NULL
      ${relationshipFilter}
    ORDER BY pm.state, pm.city
  `, [company_id]);

  // Get principals at both company and entity level
  const principals = await query<PrincipalRow[]>(`
    SELECT DISTINCT
      p.id, p.full_name, pcr.role, pcr.ownership_percentage, 'company' as relationship_level
    FROM principal_company_relationships pcr
    JOIN principals p ON p.id = pcr.principal_id
    WHERE pcr.company_id = ? AND pcr.end_date IS NULL

    UNION

    SELECT DISTINCT
      p.id, p.full_name, pner.role, pner.ownership_percentage, 'entity' as relationship_level
    FROM entities e
    JOIN principal_entity_relationships pner ON pner.entity_id = e.id AND pner.end_date IS NULL
    JOIN principals p ON p.id = pner.principal_id
    WHERE e.company_id = ?

    ORDER BY ownership_percentage DESC, full_name
  `, [company_id, company_id]);

  // Get deal activity summary
  const dealSummary = await query<DealSummaryRow[]>(`
    SELECT
      d.deal_type,
      COUNT(DISTINCT d.id) as deal_count,
      COALESCE(SUM(d.amount), 0) as total_amount,
      MAX(d.effective_date) as recent_date
    FROM deals d
    JOIN deals_parties dp ON dp.deal_id = d.id
    WHERE dp.company_id = ?
    GROUP BY d.deal_type
    ORDER BY deal_count DESC
  `, [company_id]);

  // Calculate portfolio statistics
  const stateDistribution = properties.reduce((acc: Record<string, number>, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1;
    return acc;
  }, {});

  const entityTypeBreakdown = entities.reduce((acc: Record<string, { count: number; properties: number }>, e) => {
    if (!acc[e.entity_type]) {
      acc[e.entity_type] = { count: 0, properties: 0 };
    }
    acc[e.entity_type].count += 1;
    acc[e.entity_type].properties += e.property_count;
    return acc;
  }, {});

  const relationshipBreakdown = properties.reduce((acc: Record<string, number>, p) => {
    acc[p.relationship_type] = (acc[p.relationship_type] || 0) + 1;
    return acc;
  }, {});

  const uniqueProperties = [...new Set(properties.map(p => p.id))];
  const totalBeds = properties.reduce((sum, p) => {
    // Only count each property once
    if (uniqueProperties.indexOf(p.id) === properties.findIndex(prop => prop.id === p.id)) {
      return sum + (p.bed_count || 0);
    }
    return sum;
  }, 0);

  // Deduplicate principals (might appear at both company and entity level)
  const uniquePrincipals = [...new Map(principals.map(p => [p.id, p])).values()];

  return success({
    company: {
      id: company.id,
      name: company.company_name,
      type: company.company_type,
      headquarters: company.address
        ? `${company.address}, ${company.city}, ${company.state}`
        : null
    },
    entities: entities.map(e => ({
      id: e.id,
      name: e.entity_name,
      type: e.entity_type,
      property_count: e.property_count,
      total_beds: e.total_beds
    })),
    properties: properties.map(p => ({
      id: p.id,
      ccn: p.ccn,
      facility_name: p.facility_name,
      city: p.city,
      state: p.state,
      bed_count: p.bed_count,
      entity_id: p.entity_id,
      entity_name: p.entity_name,
      entity_type: p.entity_type,
      relationship_type: p.relationship_type
    })),
    principals: uniquePrincipals.map(p => ({
      id: p.id,
      name: p.full_name,
      role: p.role,
      ownership_percentage: p.ownership_percentage,
      relationship_level: p.relationship_level
    })),
    deal_activity: dealSummary.map(d => ({
      deal_type: d.deal_type,
      count: d.deal_count,
      total_amount: Number(d.total_amount),
      most_recent: d.recent_date
    })),
    statistics: {
      entity_count: entities.length,
      entity_type_breakdown: entityTypeBreakdown,
      unique_property_count: uniqueProperties.length,
      total_beds: totalBeds,
      state_count: Object.keys(stateDistribution).length,
      state_distribution: stateDistribution,
      relationship_breakdown: relationshipBreakdown,
      principal_count: uniquePrincipals.length
    }
  });
}

export const definition = {
  name: 'get_parent_company_portfolio',
  description: 'Get comprehensive portfolio view of a parent company including all entities (PropCos/OpCos), properties, principals, and deal activity.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'number', description: 'Parent company ID' },
      include_operator_properties: { type: 'boolean', description: 'Include properties where company entities are operators (not just owners)' }
    },
    required: ['company_id']
  }
};
