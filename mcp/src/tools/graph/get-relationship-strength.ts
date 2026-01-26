/**
 * Tool: get_relationship_strength
 * Score relationships by transaction history and shared connections
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  company_id_1: z.number().describe('First company ID'),
  company_id_2: z.number().describe('Second company ID')
});

export type GetRelationshipStrengthParams = z.infer<typeof schema>;

interface CompanyRow extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
}

interface SharedPropertyRow extends RowDataPacket {
  property_id: number;
  facility_name: string;
  city: string;
  state: string;
  company1_role: string;
  company2_role: string;
}

interface SharedDealRow extends RowDataPacket {
  deal_id: number;
  deal_type: string;
  effective_date: Date | null;
  amount: number | null;
  company1_role: string;
  company2_role: string;
  property_name: string;
}

interface SharedPrincipalRow extends RowDataPacket {
  principal_id: number;
  full_name: string;
  company1_role: string;
  company2_role: string;
}

export async function execute(params: GetRelationshipStrengthParams): Promise<ToolResult> {
  const { company_id_1, company_id_2 } = params;

  if (!company_id_1 || !company_id_2) {
    return clientError('Both company_id_1 and company_id_2 are required');
  }

  // Get company details
  const company1 = await queryOne<CompanyRow>(`
    SELECT id, company_name, company_type FROM companies WHERE id = ?
  `, [company_id_1]);

  const company2 = await queryOne<CompanyRow>(`
    SELECT id, company_name, company_type FROM companies WHERE id = ?
  `, [company_id_2]);

  if (!company1) return notFound('Company', company_id_1);
  if (!company2) return notFound('Company', company_id_2);

  // Find shared properties (both have relationships to same property)
  const sharedProperties = await query<SharedPropertyRow[]>(`
    SELECT DISTINCT
      pm.id as property_id,
      pm.facility_name,
      pm.city,
      pm.state,
      per1.relationship_type as company1_role,
      per2.relationship_type as company2_role
    FROM property_master pm
    JOIN property_entity_relationships per1 ON per1.property_master_id = pm.id
    JOIN entities e1 ON e1.id = per1.entity_id AND e1.company_id = ?
    JOIN property_entity_relationships per2 ON per2.property_master_id = pm.id
    JOIN entities e2 ON e2.id = per2.entity_id AND e2.company_id = ?
    WHERE per1.end_date IS NULL AND per2.end_date IS NULL
  `, [company_id_1, company_id_2]);

  // Find shared deals (both involved in same transaction)
  const sharedDeals = await query<SharedDealRow[]>(`
    SELECT DISTINCT
      d.id as deal_id,
      d.deal_type,
      d.effective_date,
      d.amount,
      dp1.party_role as company1_role,
      dp2.party_role as company2_role,
      pm.facility_name as property_name
    FROM deals d
    JOIN deals_parties dp1 ON dp1.deal_id = d.id AND dp1.company_id = ?
    JOIN deals_parties dp2 ON dp2.deal_id = d.id AND dp2.company_id = ?
    LEFT JOIN property_master pm ON pm.id = d.property_master_id
    WHERE dp1.id != dp2.id
    ORDER BY d.effective_date DESC
  `, [company_id_1, company_id_2]);

  // Find shared principals (same person in both companies)
  const sharedPrincipals = await query<SharedPrincipalRow[]>(`
    SELECT DISTINCT
      p.id as principal_id,
      p.full_name,
      pcr1.role as company1_role,
      pcr2.role as company2_role
    FROM principals p
    JOIN principal_company_relationships pcr1 ON pcr1.principal_id = p.id AND pcr1.company_id = ?
    JOIN principal_company_relationships pcr2 ON pcr2.principal_id = p.id AND pcr2.company_id = ?
    WHERE pcr1.end_date IS NULL AND pcr2.end_date IS NULL
  `, [company_id_1, company_id_2]);

  // Calculate relationship strength score
  // Weights: shared properties = 2, shared deals = 3, shared principals = 5
  const propertyScore = sharedProperties.length * 2;
  const dealScore = sharedDeals.length * 3;
  const principalScore = sharedPrincipals.length * 5;
  const totalScore = propertyScore + dealScore + principalScore;

  // Determine relationship type
  let relationshipType = 'none';
  if (sharedPrincipals.length > 0) {
    relationshipType = 'common_ownership';
  } else if (sharedDeals.length > 0) {
    const dealRoles = sharedDeals.map(d => `${d.company1_role}-${d.company2_role}`);
    if (dealRoles.some(r => r.includes('buyer') || r.includes('seller'))) {
      relationshipType = 'transaction_counterparty';
    } else if (dealRoles.some(r => r.includes('lender'))) {
      relationshipType = 'lending_relationship';
    }
  } else if (sharedProperties.length > 0) {
    relationshipType = 'co_investment';
  }

  // Calculate total deal value
  const totalDealValue = sharedDeals.reduce((sum, d) => sum + (d.amount || 0), 0);

  return success({
    companies: {
      company_1: {
        id: company1.id,
        name: company1.company_name,
        type: company1.company_type
      },
      company_2: {
        id: company2.id,
        name: company2.company_name,
        type: company2.company_type
      }
    },
    relationship_strength: {
      total_score: totalScore,
      relationship_type: relationshipType,
      breakdown: {
        shared_properties: propertyScore,
        shared_deals: dealScore,
        shared_principals: principalScore
      }
    },
    shared_properties: sharedProperties.map(p => ({
      property_id: p.property_id,
      facility_name: p.facility_name,
      location: `${p.city}, ${p.state}`,
      company_1_role: p.company1_role,
      company_2_role: p.company2_role
    })),
    shared_deals: {
      count: sharedDeals.length,
      total_value: totalDealValue,
      deals: sharedDeals.slice(0, 10).map(d => ({
        deal_id: d.deal_id,
        deal_type: d.deal_type,
        date: d.effective_date,
        amount: d.amount,
        property: d.property_name,
        company_1_role: d.company1_role,
        company_2_role: d.company2_role
      }))
    },
    shared_principals: sharedPrincipals.map(p => ({
      principal_id: p.principal_id,
      name: p.full_name,
      company_1_role: p.company1_role,
      company_2_role: p.company2_role
    })),
    summary: {
      have_relationship: totalScore > 0,
      relationship_depth: totalScore > 15 ? 'strong' : totalScore > 5 ? 'moderate' : totalScore > 0 ? 'weak' : 'none'
    }
  });
}

export const definition = {
  name: 'get_relationship_strength',
  description: 'Analyze the strength of relationship between two companies based on shared properties, deals, and principals.',
  inputSchema: {
    type: 'object',
    properties: {
      company_id_1: { type: 'number', description: 'First company ID' },
      company_id_2: { type: 'number', description: 'Second company ID' }
    },
    required: ['company_id_1', 'company_id_2']
  }
};
