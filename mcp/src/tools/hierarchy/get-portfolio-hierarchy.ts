/**
 * Tool: get_portfolio_hierarchy
 * Multi-level hierarchy traversal from property up to ultimate beneficial owners
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Start from property ID'),
  ccn: z.string().optional().describe('Start from CCN'),
  entity_id: z.number().optional().describe('Start from entity ID'),
  company_id: z.number().optional().describe('Start from company ID'),
  include_siblings: z.boolean().default(false).describe('Include sibling entities/properties at each level')
}).refine(data => data.property_id || data.ccn || data.entity_id || data.company_id, {
  message: 'At least one starting point must be provided'
});

export type GetPortfolioHierarchyParams = z.infer<typeof schema>;

interface PropertyRow extends RowDataPacket {
  id: number;
  ccn: string;
  facility_name: string;
  city: string;
  state: string;
}

interface EntityRow extends RowDataPacket {
  id: number;
  entity_name: string;
  entity_type: string;
  company_id: number;
  relationship_type: string;
}

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
}

interface PrincipalRow extends RowDataPacket {
  id: number;
  full_name: string;
  role: string;
  ownership_percentage: number | null;
}

interface HierarchyLevel {
  level: number;
  type: string;
  data: object;
  children?: HierarchyLevel[];
}

export async function execute(params: GetPortfolioHierarchyParams): Promise<ToolResult> {
  const { property_id, ccn, entity_id, company_id, include_siblings = false } = params;

  const hierarchy: HierarchyLevel[] = [];
  let currentLevel = 0;

  // Level 0: Property (if starting from property)
  let propertyData: PropertyRow | null = null;
  let entityIds: number[] = [];

  if (property_id || ccn) {
    if (property_id) {
      propertyData = await queryOne<PropertyRow>(`
        SELECT id, ccn, facility_name, city, state
        FROM property_master WHERE id = ?
      `, [property_id]);
    } else if (ccn) {
      propertyData = await queryOne<PropertyRow>(`
        SELECT id, ccn, facility_name, city, state
        FROM property_master WHERE ccn = ?
      `, [ccn]);
    }

    if (!propertyData) return notFound('Property', property_id || ccn || '');

    // Get entities for this property
    const entities = await query<EntityRow[]>(`
      SELECT e.id, e.entity_name, e.entity_type, e.company_id, per.relationship_type
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id
      WHERE per.property_master_id = ? AND per.end_date IS NULL
    `, [propertyData.id]);

    hierarchy.push({
      level: currentLevel,
      type: 'property',
      data: {
        id: propertyData.id,
        ccn: propertyData.ccn,
        facility_name: propertyData.facility_name,
        location: `${propertyData.city}, ${propertyData.state}`
      }
    });

    currentLevel++;
    entityIds = entities.map(e => e.id);

    // Level 1: Entities
    const entityLevel: HierarchyLevel = {
      level: currentLevel,
      type: 'entities',
      data: {
        count: entities.length,
        entities: entities.map(e => ({
          id: e.id,
          name: e.entity_name,
          type: e.entity_type,
          relationship: e.relationship_type,
          company_id: e.company_id
        }))
      }
    };

    hierarchy.push(entityLevel);
    currentLevel++;
  }

  // If starting from entity, get that entity
  if (entity_id && !property_id && !ccn) {
    const entity = await queryOne<EntityRow>(`
      SELECT e.id, e.entity_name, e.entity_type, e.company_id, 'direct' as relationship_type
      FROM entities e WHERE e.id = ?
    `, [entity_id]);

    if (!entity) return notFound('Entity', entity_id);

    entityIds = [entity.id];

    hierarchy.push({
      level: currentLevel,
      type: 'entity',
      data: {
        id: entity.id,
        name: entity.entity_name,
        type: entity.entity_type,
        company_id: entity.company_id
      }
    });
    currentLevel++;
  }

  // Get companies from entities
  let companyIds: number[] = [];
  if (entityIds.length > 0) {
    const placeholders = entityIds.map(() => '?').join(',');
    const companies = await query<CompanyRow[]>(`
      SELECT DISTINCT c.id, c.company_name, c.company_type
      FROM entities e
      JOIN companies c ON c.id = e.company_id
      WHERE e.id IN (${placeholders}) AND c.company_name NOT LIKE '[MERGED]%'
    `, entityIds);

    companyIds = companies.map(c => c.id);

    // Level 2: Companies
    hierarchy.push({
      level: currentLevel,
      type: 'companies',
      data: {
        count: companies.length,
        companies: companies.map(c => ({
          id: c.id,
          name: c.company_name,
          type: c.company_type
        }))
      }
    });
    currentLevel++;
  }

  // If starting from company
  if (company_id && !entity_id && !property_id && !ccn) {
    const company = await queryOne<CompanyRow>(`
      SELECT id, company_name, company_type FROM companies WHERE id = ?
    `, [company_id]);

    if (!company) return notFound('Company', company_id);

    companyIds = [company.id];

    hierarchy.push({
      level: currentLevel,
      type: 'company',
      data: {
        id: company.id,
        name: company.company_name,
        type: company.company_type
      }
    });
    currentLevel++;
  }

  // Level 3: Principals (ultimate beneficial owners)
  if (companyIds.length > 0) {
    const placeholders = companyIds.map(() => '?').join(',');

    // Get principals from both company and entity relationships
    const principals = await query<PrincipalRow[]>(`
      SELECT DISTINCT p.id, p.full_name, pcr.role, pcr.ownership_percentage
      FROM principal_company_relationships pcr
      JOIN principals p ON p.id = pcr.principal_id
      WHERE pcr.company_id IN (${placeholders}) AND pcr.end_date IS NULL

      UNION

      SELECT DISTINCT p.id, p.full_name, pner.role, pner.ownership_percentage
      FROM entities e
      JOIN principal_entity_relationships pner ON pner.entity_id = e.id AND pner.end_date IS NULL
      JOIN principals p ON p.id = pner.principal_id
      WHERE e.company_id IN (${placeholders})

      ORDER BY ownership_percentage DESC, full_name
    `, [...companyIds, ...companyIds]);

    // Deduplicate
    const uniquePrincipals = [...new Map(principals.map(p => [p.id, p])).values()];

    hierarchy.push({
      level: currentLevel,
      type: 'principals',
      data: {
        count: uniquePrincipals.length,
        ultimate_beneficial_owners: uniquePrincipals.map(p => ({
          id: p.id,
          name: p.full_name,
          role: p.role,
          ownership_percentage: p.ownership_percentage
        }))
      }
    });
  }

  // Include sibling information if requested
  let siblings = null;
  if (include_siblings && companyIds.length > 0) {
    const placeholders = companyIds.map(() => '?').join(',');

    // Sibling entities under same company
    const siblingEntities = await query<EntityRow[]>(`
      SELECT e.id, e.entity_name, e.entity_type, e.company_id, 'sibling' as relationship_type
      FROM entities e
      WHERE e.company_id IN (${placeholders})
        ${entityIds.length > 0 ? `AND e.id NOT IN (${entityIds.map(() => '?').join(',')})` : ''}
      LIMIT 50
    `, entityIds.length > 0 ? [...companyIds, ...entityIds] : companyIds);

    // Sibling properties (other properties under same entities/companies)
    const siblingProps = await query<PropertyRow[]>(`
      SELECT DISTINCT pm.id, pm.ccn, pm.facility_name, pm.city, pm.state
      FROM property_entity_relationships per
      JOIN entities e ON e.id = per.entity_id
      JOIN property_master pm ON pm.id = per.property_master_id
      WHERE e.company_id IN (${placeholders})
        ${propertyData ? 'AND pm.id != ?' : ''}
        AND per.end_date IS NULL
      LIMIT 50
    `, propertyData ? [...companyIds, propertyData.id] : companyIds);

    siblings = {
      sibling_entities: siblingEntities.map(e => ({
        id: e.id,
        name: e.entity_name,
        type: e.entity_type
      })),
      sibling_properties: siblingProps.map(p => ({
        id: p.id,
        ccn: p.ccn,
        facility_name: p.facility_name,
        location: `${p.city}, ${p.state}`
      }))
    };
  }

  return success({
    hierarchy,
    summary: {
      total_levels: hierarchy.length,
      start_point: property_id || ccn ? 'property' : entity_id ? 'entity' : 'company',
      companies_found: companyIds.length,
      entities_found: entityIds.length
    },
    siblings: siblings
  });
}

export const definition = {
  name: 'get_portfolio_hierarchy',
  description: 'Get multi-level ownership hierarchy from property/entity/company up to ultimate beneficial owners. Shows complete ownership chain with optional sibling information.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Start from property ID' },
      ccn: { type: 'string', description: 'Start from CCN' },
      entity_id: { type: 'number', description: 'Start from entity ID' },
      company_id: { type: 'number', description: 'Start from company ID' },
      include_siblings: { type: 'boolean', description: 'Include sibling entities/properties at each level' }
    }
  }
};
