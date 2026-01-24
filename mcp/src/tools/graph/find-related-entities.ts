/**
 * Tool: find_related_entities
 * Find companies that share properties with a given company (cross-reference analysis)
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  company_id: z.number().describe('Company ID to find relationships for'),
  relationship_type: z.string().optional().describe('Filter source company relationship (property_owner, facility_operator)'),
  related_type: z.string().optional().describe('Filter related company relationship type'),
  limit: z.number().min(1).max(50).default(20).describe('Maximum results (default 20, max 50)')
});

export type FindRelatedEntitiesParams = z.infer<typeof schema>;

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
}

interface RelatedCompanyRow extends RowDataPacket {
  company_id: number;
  company_name: string;
  company_type: string | null;
  shared_properties: number;
  relationship_type: string;
}

export async function execute(params: FindRelatedEntitiesParams): Promise<ToolResult> {
  const { company_id, relationship_type, related_type, limit = 20 } = params;

  if (!company_id) {
    return missingParam('company_id');
  }

  // Get company info
  const company = await queryOne<CompanyRow>(`
    SELECT id, company_name, company_type
    FROM companies WHERE id = ? AND company_name NOT LIKE '[MERGED]%'
  `, [company_id]);

  if (!company) {
    return notFound('Company', company_id);
  }

  // Find operators who work with this owner's properties (showcase-navigation.js STEP 6 pattern)
  // This finds companies that have relationships with the same properties
  const sourceRelType = relationship_type || 'property_owner';
  const targetRelType = related_type || 'facility_operator';

  const relatedCompanies = await query<RelatedCompanyRow[]>(`
    SELECT c.id as company_id, c.company_name, c.company_type,
           COUNT(DISTINCT pm.id) as shared_properties,
           ? as relationship_type
    FROM property_master pm
    JOIN property_entity_relationships per_src ON per_src.property_master_id = pm.id
      AND per_src.relationship_type = ?
    JOIN entities e_src ON e_src.id = per_src.entity_id AND e_src.company_id = ?
    JOIN property_entity_relationships per_tgt ON per_tgt.property_master_id = pm.id
      AND per_tgt.relationship_type = ?
    JOIN entities e_tgt ON e_tgt.id = per_tgt.entity_id
    JOIN companies c ON c.id = e_tgt.company_id AND c.id != ?
    WHERE c.company_name NOT LIKE '[MERGED]%'
    GROUP BY c.id, c.company_name, c.company_type
    ORDER BY shared_properties DESC
    LIMIT ?
  `, [targetRelType, sourceRelType, company_id, targetRelType, company_id, limit]);

  // Also find lenders if source is owner
  let lenders: RelatedCompanyRow[] = [];
  if (sourceRelType === 'property_owner') {
    lenders = await query<RelatedCompanyRow[]>(`
      SELECT c.id as company_id, c.company_name, c.company_type,
             COUNT(DISTINCT pm.id) as shared_properties,
             'lender' as relationship_type
      FROM property_master pm
      JOIN property_entity_relationships per_own ON per_own.property_master_id = pm.id
        AND per_own.relationship_type = 'property_owner'
      JOIN entities e_own ON e_own.id = per_own.entity_id AND e_own.company_id = ?
      JOIN property_entity_relationships per_lend ON per_lend.property_master_id = pm.id
        AND per_lend.relationship_type = 'lender'
      JOIN entities e_lend ON e_lend.id = per_lend.entity_id
      JOIN companies c ON c.id = e_lend.company_id
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id, c.company_name, c.company_type
      ORDER BY shared_properties DESC
      LIMIT ?
    `, [company_id, limit]);
  }

  return success({
    company: {
      id: company.id,
      name: company.company_name,
      type: company.company_type,
      source_relationship: sourceRelType
    },
    related_companies: {
      [targetRelType]: relatedCompanies.map(r => ({
        id: r.company_id,
        name: r.company_name,
        type: r.company_type,
        shared_properties: r.shared_properties
      })),
      ...(lenders.length > 0 ? {
        lender: lenders.map(r => ({
          id: r.company_id,
          name: r.company_name,
          type: r.company_type,
          shared_properties: r.shared_properties
        }))
      } : {})
    },
    summary: {
      total_related_companies: relatedCompanies.length + lenders.length,
      relationship_types_found: [
        ...(relatedCompanies.length > 0 ? [targetRelType] : []),
        ...(lenders.length > 0 ? ['lender'] : [])
      ]
    }
  });
}

export const definition = {
  name: 'find_related_entities',
  description: 'Find companies that share properties with a given company (e.g., which operators run a certain owner\'s properties, or which lenders finance them)',
  inputSchema: {
    type: 'object',
    properties: {
      company_id: { type: 'number', description: 'Company ID to find relationships for' },
      relationship_type: { type: 'string', description: 'Filter source company relationship (property_owner, facility_operator)' },
      related_type: { type: 'string', description: 'Filter related company relationship type' },
      limit: { type: 'number', description: 'Maximum results (default 20, max 50)' }
    },
    required: ['company_id']
  }
};
