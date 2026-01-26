/**
 * Tool: trace_principal_network
 * Trace a principal's network: Principal → Companies → Properties
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  principal_id: z.number().describe('Principal ID'),
  include_historical: z.boolean().default(false).describe('Include historical (ended) relationships')
});

export type TracePrincipalNetworkParams = z.infer<typeof schema>;

interface PrincipalRow extends RowDataPacket {
  id: number;
  full_name: string;
  title: string | null;
  city: string | null;
  state: string | null;
}

interface CompanyRelRow extends RowDataPacket {
  company_id: number;
  company_name: string;
  company_type: string | null;
  roles: string;  // Comma-separated list of roles
  ownership_percentage: number | null;
  earliest_effective_date: Date | null;
  is_current: boolean;
}

interface PropertyRow extends RowDataPacket {
  company_id: number;
  property_id: number;
  ccn: string;
  facility_name: string;
  city: string;
  state: string;
  relationship_type: string;
}

export async function execute(params: TracePrincipalNetworkParams): Promise<ToolResult> {
  const { principal_id, include_historical = false } = params;

  if (!principal_id) {
    return missingParam('principal_id');
  }

  // Get principal info
  const principal = await queryOne<PrincipalRow>(`
    SELECT id, full_name, title, city, state
    FROM principals WHERE id = ?
  `, [principal_id]);

  if (!principal) {
    return notFound('Principal', principal_id);
  }

  // Get company relationships - group by company, aggregate roles
  const endDateFilter = include_historical ? '' : 'AND pcr.end_date IS NULL';
  const companyRels = await query<CompanyRelRow[]>(`
    SELECT c.id as company_id, c.company_name, c.company_type,
           GROUP_CONCAT(DISTINCT pcr.role ORDER BY pcr.role) as roles,
           MAX(pcr.ownership_percentage) as ownership_percentage,
           MIN(pcr.effective_date) as earliest_effective_date,
           MAX(pcr.end_date IS NULL) as is_current
    FROM principal_company_relationships pcr
    JOIN companies c ON c.id = pcr.company_id
    WHERE pcr.principal_id = ?
      ${endDateFilter}
      AND c.company_name NOT LIKE '[MERGED]%'
    GROUP BY c.id, c.company_name, c.company_type
    ORDER BY is_current DESC, ownership_percentage DESC, c.company_name
  `, [principal_id]);

  // Get properties for each company
  const companyIds = companyRels.map(c => c.company_id);
  let properties: PropertyRow[] = [];

  if (companyIds.length > 0) {
    const placeholders = companyIds.map(() => '?').join(',');
    properties = await query<PropertyRow[]>(`
      SELECT e.company_id, pm.id as property_id, pm.ccn, pm.facility_name,
             pm.city, pm.state, per.relationship_type
      FROM property_master pm
      JOIN property_entity_relationships per ON per.property_master_id = pm.id
      JOIN entities e ON e.id = per.entity_id
      WHERE e.company_id IN (${placeholders})
      ORDER BY e.company_id, pm.state, pm.city
    `, companyIds);
  }

  // Group properties by company, dedupe by property_id
  const propertiesByCompany: Record<number, Map<number, PropertyRow>> = {};
  for (const p of properties) {
    if (!propertiesByCompany[p.company_id]) propertiesByCompany[p.company_id] = new Map();
    // Keep first occurrence (or could merge relationship_types)
    if (!propertiesByCompany[p.company_id].has(p.property_id)) {
      propertiesByCompany[p.company_id].set(p.property_id, p);
    }
  }

  // Calculate totals (unique properties across all companies)
  const totalProperties = new Set(properties.map(p => p.property_id)).size;
  const totalStates = new Set(properties.map(p => p.state)).size;

  return success({
    principal: {
      id: principal.id,
      name: principal.full_name,
      title: principal.title,
      city: principal.city,
      state: principal.state
    },
    summary: {
      company_count: companyRels.length,
      total_properties: totalProperties,
      states_represented: totalStates,
      active_companies: companyRels.filter(c => c.is_current).length,
      historical_companies: companyRels.filter(c => !c.is_current).length
    },
    companies: companyRels.map(c => {
      const companyProps = propertiesByCompany[c.company_id]
        ? Array.from(propertiesByCompany[c.company_id].values())
        : [];
      return {
        id: c.company_id,
        name: c.company_name,
        type: c.company_type,
        roles: c.roles ? c.roles.split(',') : [],
        ownership_percentage: c.ownership_percentage,
        is_current: Boolean(c.is_current),
        effective_date: c.earliest_effective_date,
        property_count: companyProps.length,
        properties: companyProps.slice(0, 10).map(p => ({
          id: p.property_id,
          ccn: p.ccn,
          facility_name: p.facility_name,
          city: p.city,
          state: p.state
        }))
      };
    })
  });
}

export const definition = {
  name: 'trace_principal_network',
  description: 'Trace a principal\'s full network: companies they control or are affiliated with, and all properties under those companies',
  inputSchema: {
    type: 'object',
    properties: {
      principal_id: { type: 'number', description: 'Principal ID' },
      include_historical: { type: 'boolean', description: 'Include historical (ended) relationships' }
    },
    required: ['principal_id']
  }
};
