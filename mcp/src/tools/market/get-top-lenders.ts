/**
 * Tool: get_top_lenders
 * Get major financing providers by deal volume
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  state: z.string().optional().describe('State code to filter (e.g., TX, CA)'),
  days: z.number().min(1).max(365).default(90).describe('Look-back period in days (default 90)'),
  limit: z.number().min(1).max(50).default(20).describe('Maximum results (default 20, max 50)')
});

export type GetTopLendersParams = z.infer<typeof schema>;

interface LenderRow extends RowDataPacket {
  company_id: number;
  company_name: string;
  loan_count: number;
  total_amount: number;
  property_count: number;
  states: string;
  avg_loan_size: number;
}

export async function execute(params: GetTopLendersParams): Promise<ToolResult> {
  const { state, days = 90, limit = 20 } = params;

  const conditions: string[] = [
    'd.effective_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)',
    "dp.party_role = 'lender'",
    'dp.company_id IS NOT NULL',
    "c.company_name NOT LIKE '[MERGED]%'",
    "d.deal_type IN ('mortgage', 'refinance')"
  ];
  const values: (string | number)[] = [days];

  if (state) {
    conditions.push('pm.state = ?');
    values.push(state.toUpperCase());
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  values.push(limit);

  const lenders = await query<LenderRow[]>(`
    SELECT
      dp.company_id,
      c.company_name,
      COUNT(DISTINCT d.id) as loan_count,
      COALESCE(SUM(d.amount), 0) as total_amount,
      COUNT(DISTINCT d.property_master_id) as property_count,
      GROUP_CONCAT(DISTINCT pm.state ORDER BY pm.state) as states,
      COALESCE(AVG(d.amount), 0) as avg_loan_size
    FROM deals d
    JOIN deals_parties dp ON dp.deal_id = d.id
    JOIN companies c ON c.id = dp.company_id
    LEFT JOIN property_master pm ON pm.id = d.property_master_id
    ${whereClause}
    GROUP BY dp.company_id, c.company_name
    ORDER BY loan_count DESC, total_amount DESC
    LIMIT ?
  `, values);

  return success({
    period_days: days,
    filters: {
      state: state || 'all'
    },
    count: lenders.length,
    top_lenders: lenders.map((l, idx) => ({
      rank: idx + 1,
      company_id: l.company_id,
      company_name: l.company_name,
      loan_count: l.loan_count,
      total_amount: Number(l.total_amount),
      property_count: l.property_count,
      avg_loan_size: Math.round(Number(l.avg_loan_size)),
      active_states: l.states ? l.states.split(',') : []
    }))
  });
}

export const definition = {
  name: 'get_top_lenders',
  description: 'Get the most active lenders ranked by loan count. Shows financing volume, total amounts, and geographic footprint for mortgage/refinance deals.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'State code to filter (e.g., TX, CA)' },
      days: { type: 'number', description: 'Look-back period in days (default 90)' },
      limit: { type: 'number', description: 'Maximum results (default 20, max 50)' }
    }
  }
};
