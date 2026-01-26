/**
 * Tool: get_network_centrality
 * Identify most-connected power players in the SNF ownership network
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  node_type: z.enum(['company', 'principal', 'entity']).default('company').describe('Type of nodes to rank'),
  metric: z.enum(['degree', 'property_count', 'transaction_count']).default('degree').describe('Centrality metric to use'),
  state: z.string().optional().describe('Filter by state'),
  limit: z.number().min(1).max(100).default(25).describe('Maximum results (default 25)')
});

export type GetNetworkCentralityParams = z.infer<typeof schema>;

const WEIGHTS = {
  property: 10,
  entity: 2,
  principal: 3,
  deal: 5,
  company: 4
};

interface CompanyRow extends RowDataPacket {
  id: number;
  name: string;
  type: string | null;
  hq_state: string | null;
  property_count: number;
}

interface PrincipalRow extends RowDataPacket {
  id: number;
  name: string;
  title: string | null;
  company_count: number;
  property_count: number;
}

interface EntityRow extends RowDataPacket {
  id: number;
  name: string;
  type: string | null;
  state: string | null;
  company_name: string | null;
  property_count: number;
}

function getTier(rank: number, total: number): { tier: string; description: string } {
  const pct = (rank / total) * 100;
  if (pct <= 5) return { tier: 'DOMINANT', description: 'Top 5% - Market leader' };
  if (pct <= 15) return { tier: 'MAJOR', description: 'Top 15% - Major player' };
  if (pct <= 35) return { tier: 'ESTABLISHED', description: 'Top 35% - Established presence' };
  if (pct <= 60) return { tier: 'EMERGING', description: 'Top 60% - Growing footprint' };
  return { tier: 'LOCAL', description: 'Regional operator' };
}

export async function execute(params: GetNetworkCentralityParams): Promise<ToolResult> {
  const { node_type = 'company', metric = 'degree', state, limit = 25 } = params;

  if (node_type === 'company') {
    // Fast query using indexed property_count from property_entity_relationships
    const sql = state ? `
      SELECT
        c.id,
        c.company_name as name,
        c.company_type as type,
        c.state as hq_state,
        COUNT(DISTINCT per.property_master_id) as property_count
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id AND pm.state = ?
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id
      ORDER BY property_count DESC
      LIMIT ?
    ` : `
      SELECT
        c.id,
        c.company_name as name,
        c.company_type as type,
        c.state as hq_state,
        COUNT(DISTINCT per.property_master_id) as property_count
      FROM companies c
      JOIN entities e ON e.company_id = c.id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      WHERE c.company_name NOT LIKE '[MERGED]%'
      GROUP BY c.id
      ORDER BY property_count DESC
      LIMIT ?
    `;

    const params = state ? [state.toUpperCase(), limit] : [limit];
    const companies = await query<CompanyRow[]>(sql, params);

    const maxProps = companies[0]?.property_count || 1;

    return success({
      analysis_type: 'network_centrality',
      node_type,
      metric,
      filters: { state: state?.toUpperCase() || 'ALL' },
      count: companies.length,
      power_rankings: companies.map((c, idx) => {
        const tierInfo = getTier(idx + 1, companies.length);
        const score = c.property_count * WEIGHTS.property;
        return {
          rank: idx + 1,
          id: c.id,
          name: c.name,
          type: c.type || 'unknown',
          headquarters: c.hq_state,
          tier: tierInfo.tier,
          tier_description: tierInfo.description,
          influence_score: score,
          property_count: c.property_count,
          pct_of_leader: Math.round((c.property_count / maxProps) * 100)
        };
      })
    });
  }

  if (node_type === 'principal') {
    const sql = `
      SELECT
        p.id,
        p.full_name as name,
        (SELECT pcr2.title FROM principal_company_relationships pcr2
         WHERE pcr2.principal_id = p.id AND pcr2.end_date IS NULL LIMIT 1) as title,
        COUNT(DISTINCT pcr.company_id) as company_count,
        COUNT(DISTINCT per.property_master_id) as property_count
      FROM principals p
      JOIN principal_company_relationships pcr ON pcr.principal_id = p.id AND pcr.end_date IS NULL
      LEFT JOIN entities e ON e.company_id = pcr.company_id
      LEFT JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      WHERE p.full_name NOT LIKE '[MERGED]%'
      GROUP BY p.id
      ORDER BY property_count DESC, company_count DESC
      LIMIT ?
    `;

    const principals = await query<PrincipalRow[]>(sql, [limit]);
    const maxProps = principals[0]?.property_count || 1;

    return success({
      analysis_type: 'network_centrality',
      node_type,
      metric,
      count: principals.length,
      power_rankings: principals.map((p, idx) => {
        const tierInfo = getTier(idx + 1, principals.length);
        const score = p.property_count * WEIGHTS.property + p.company_count * WEIGHTS.company;
        return {
          rank: idx + 1,
          id: p.id,
          name: p.name,
          title: p.title,
          tier: tierInfo.tier,
          tier_description: tierInfo.description,
          influence_score: score,
          company_count: p.company_count,
          property_count: p.property_count,
          pct_of_leader: Math.round((p.property_count / maxProps) * 100)
        };
      })
    });
  }

  if (node_type === 'entity') {
    const sql = state ? `
      SELECT
        e.id,
        e.entity_name as name,
        e.entity_type as type,
        e.state,
        c.company_name,
        COUNT(DISTINCT per.property_master_id) as property_count
      FROM entities e
      LEFT JOIN companies c ON c.id = e.company_id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      JOIN property_master pm ON pm.id = per.property_master_id AND pm.state = ?
      GROUP BY e.id
      ORDER BY property_count DESC
      LIMIT ?
    ` : `
      SELECT
        e.id,
        e.entity_name as name,
        e.entity_type as type,
        e.state,
        c.company_name,
        COUNT(DISTINCT per.property_master_id) as property_count
      FROM entities e
      LEFT JOIN companies c ON c.id = e.company_id
      JOIN property_entity_relationships per ON per.entity_id = e.id AND per.end_date IS NULL
      GROUP BY e.id
      ORDER BY property_count DESC
      LIMIT ?
    `;

    const params = state ? [state.toUpperCase(), limit] : [limit];
    const entities = await query<EntityRow[]>(sql, params);
    const maxProps = entities[0]?.property_count || 1;

    return success({
      analysis_type: 'network_centrality',
      node_type,
      metric,
      filters: { state: state?.toUpperCase() || 'ALL' },
      count: entities.length,
      power_rankings: entities.map((e, idx) => {
        const tierInfo = getTier(idx + 1, entities.length);
        return {
          rank: idx + 1,
          id: e.id,
          name: e.name,
          type: e.type,
          state: e.state,
          parent_company: e.company_name,
          tier: tierInfo.tier,
          tier_description: tierInfo.description,
          influence_score: e.property_count * WEIGHTS.property,
          property_count: e.property_count,
          pct_of_leader: Math.round((e.property_count / maxProps) * 100)
        };
      })
    });
  }

  return success({ error: 'Invalid node_type', valid_options: ['company', 'principal', 'entity'] });
}

export const definition = {
  name: 'get_network_centrality',
  description: 'Identify the most connected/central nodes in the ownership network. Ranks companies, principals, or entities by their degree of connectivity.',
  inputSchema: {
    type: 'object',
    properties: {
      node_type: { type: 'string', enum: ['company', 'principal', 'entity'], description: 'Type of nodes to rank' },
      metric: { type: 'string', enum: ['degree', 'property_count', 'transaction_count'], description: 'Centrality metric to use' },
      state: { type: 'string', description: 'Filter by state' },
      limit: { type: 'number', description: 'Maximum results (default 25)' }
    }
  }
};
