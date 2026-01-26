/**
 * Tool: get_market_stats
 * Get transaction statistics by state and time period
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  state: z.string().optional().describe('State code to filter (e.g., TX, CA). If omitted, returns all states.'),
  deal_type: z.string().optional().describe('Filter by deal type (chow, sale, mortgage, etc.)'),
  days: z.number().min(1).max(365).default(90).describe('Look-back period in days (default 90, max 365)'),
  group_by: z.enum(['state', 'deal_type', 'month']).default('state').describe('Group results by state, deal_type, or month')
});

export type GetMarketStatsParams = z.infer<typeof schema>;

interface StatsRow extends RowDataPacket {
  group_key: string;
  transaction_count: number;
  total_amount: number;
  avg_amount: number;
  property_count: number;
}

export async function execute(params: GetMarketStatsParams): Promise<ToolResult> {
  const { state, deal_type, days = 90, group_by = 'state' } = params;

  const conditions: string[] = ['d.effective_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)'];
  const values: (string | number)[] = [days];

  if (state) {
    conditions.push('pm.state = ?');
    values.push(state.toUpperCase());
  }

  if (deal_type) {
    conditions.push('d.deal_type = ?');
    values.push(deal_type.toLowerCase());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Determine grouping column
  let groupColumn: string;
  let selectColumn: string;
  switch (group_by) {
    case 'deal_type':
      groupColumn = 'd.deal_type';
      selectColumn = 'd.deal_type as group_key';
      break;
    case 'month':
      groupColumn = "DATE_FORMAT(d.effective_date, '%Y-%m')";
      selectColumn = "DATE_FORMAT(d.effective_date, '%Y-%m') as group_key";
      break;
    default:
      groupColumn = 'pm.state';
      selectColumn = 'pm.state as group_key';
  }

  const stats = await query<StatsRow[]>(`
    SELECT
      ${selectColumn},
      COUNT(*) as transaction_count,
      COALESCE(SUM(d.amount), 0) as total_amount,
      COALESCE(AVG(d.amount), 0) as avg_amount,
      COUNT(DISTINCT d.property_master_id) as property_count
    FROM deals d
    LEFT JOIN property_master pm ON pm.id = d.property_master_id
    ${whereClause}
    GROUP BY ${groupColumn}
    ORDER BY transaction_count DESC
  `, values);

  // Calculate totals
  const totals = stats.reduce((acc, row) => ({
    transactions: acc.transactions + row.transaction_count,
    amount: acc.amount + Number(row.total_amount),
    properties: acc.properties + row.property_count
  }), { transactions: 0, amount: 0, properties: 0 });

  return success({
    period_days: days,
    filters: { state: state || 'all', deal_type: deal_type || 'all' },
    grouped_by: group_by,
    totals: {
      transaction_count: totals.transactions,
      total_amount: totals.amount,
      unique_properties: totals.properties
    },
    breakdown: stats.map(s => ({
      [group_by]: s.group_key,
      transaction_count: s.transaction_count,
      total_amount: Number(s.total_amount),
      avg_amount: Math.round(Number(s.avg_amount)),
      property_count: s.property_count
    }))
  });
}

export const definition = {
  name: 'get_market_stats',
  description: 'Get transaction statistics aggregated by state, deal type, or month. Provides volume, amounts, and property counts for market analysis.',
  inputSchema: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'State code to filter (e.g., TX, CA). If omitted, returns all states.' },
      deal_type: { type: 'string', description: 'Filter by deal type (chow, sale, mortgage, etc.)' },
      days: { type: 'number', description: 'Look-back period in days (default 90, max 365)' },
      group_by: { type: 'string', enum: ['state', 'deal_type', 'month'], description: 'Group results by state, deal_type, or month' }
    }
  }
};
