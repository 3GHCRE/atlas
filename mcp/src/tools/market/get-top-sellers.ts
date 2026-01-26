/**
 * Tool: get_top_sellers
 * Get most active sellers by deal volume
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  state: z.string().optional().describe('State code to filter (e.g., TX, CA)'),
  days: z.number().min(1).max(365).default(90).describe('Look-back period in days (default 90)'),
  deal_type: z.string().optional().describe('Filter by deal type (chow, sale, etc.)'),
  limit: z.number().min(1).max(50).default(20).describe('Maximum results (default 20, max 50)')
});

export type GetTopSellersParams = z.infer<typeof schema>;

interface SellerRow extends RowDataPacket {
  company_id: number;
  company_name: string;
  deal_count: number;
  total_amount: number;
  property_count: number;
  states: string;
  avg_deal_size: number;
}

export async function execute(params: GetTopSellersParams): Promise<ToolResult> {
  const { state, days = 90, deal_type, limit = 20 } = params;

  const conditions: string[] = [
    'd.effective_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)',
    "dp.party_role = 'seller'",
    'dp.company_id IS NOT NULL',
    "c.company_name NOT LIKE '[MERGED]%'"
  ];
  const values: (string | number)[] = [days];

  if (state) {
    conditions.push('pm.state = ?');
    values.push(state.toUpperCase());
  }

  if (deal_type) {
    conditions.push('d.deal_type = ?');
    values.push(deal_type.toLowerCase());
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  values.push(limit);

  const sellers = await query<SellerRow[]>(`
    SELECT
      dp.company_id,
      c.company_name,
      COUNT(DISTINCT d.id) as deal_count,
      COALESCE(SUM(d.amount), 0) as total_amount,
      COUNT(DISTINCT d.property_master_id) as property_count,
      GROUP_CONCAT(DISTINCT pm.state ORDER BY pm.state) as states,
      COALESCE(AVG(d.amount), 0) as avg_deal_size
    FROM deals d
    JOIN deals_parties dp ON dp.deal_id = d.id
    JOIN companies c ON c.id = dp.company_id
    LEFT JOIN property_master pm ON pm.id = d.property_master_id
    ${whereClause}
    GROUP BY dp.company_id, c.company_name
    ORDER BY deal_count DESC, total_amount DESC
    LIMIT ?
  `, values);

  return success({
    period_days: days,
    filters: {
      state: state || 'all',
      deal_type: deal_type || 'all'
    },
    count: sellers.length,
    top_sellers: sellers.map((s, idx) => ({
      rank: idx + 1,
      company_id: s.company_id,
      company_name: s.company_name,
      deal_count: s.deal_count,
      total_amount: Number(s.total_amount),
      property_count: s.property_count,
      avg_deal_size: Math.round(Number(s.avg_deal_size)),
      active_states: s.states ? s.states.split(',') : []
    }))
  });
}

export const definition = {
  name: 'get_top_sellers',
  description: 'Get the most active sellers ranked by deal count. Shows disposal volume, total amounts, and geographic footprint.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'State code to filter (e.g., TX, CA)' },
      days: { type: 'number', description: 'Look-back period in days (default 90)' },
      deal_type: { type: 'string', description: 'Filter by deal type (chow, sale, etc.)' },
      limit: { type: 'number', description: 'Maximum results (default 20, max 50)' }
    }
  }
};
