/**
 * Tool: get_hot_markets
 * Get state-level market activity breakdown
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  days: z.number().min(1).max(365).default(90).describe('Look-back period in days (default 90)'),
  deal_type: z.string().optional().describe('Filter by deal type (chow, sale, mortgage, etc.)'),
  min_deals: z.number().min(1).default(1).describe('Minimum deal count to include state (default 1)'),
  limit: z.number().min(1).max(52).default(25).describe('Maximum states to return (default 25)')
});

export type GetHotMarketsParams = z.infer<typeof schema>;

interface MarketRow extends RowDataPacket {
  state: string;
  deal_count: number;
  total_amount: number;
  property_count: number;
  chow_count: number;
  sale_count: number;
  mortgage_count: number;
  avg_deal_size: number;
  unique_buyers: number;
  unique_sellers: number;
}

export async function execute(params: GetHotMarketsParams): Promise<ToolResult> {
  const { days = 90, deal_type, min_deals = 1, limit = 25 } = params;

  const conditions: string[] = [
    'd.effective_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)',
    'pm.state IS NOT NULL'
  ];
  const values: (string | number)[] = [days];

  if (deal_type) {
    conditions.push('d.deal_type = ?');
    values.push(deal_type.toLowerCase());
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  values.push(min_deals, limit);

  const markets = await query<MarketRow[]>(`
    SELECT
      pm.state,
      COUNT(DISTINCT d.id) as deal_count,
      COALESCE(SUM(d.amount), 0) as total_amount,
      COUNT(DISTINCT d.property_master_id) as property_count,
      SUM(CASE WHEN d.deal_type = 'chow' THEN 1 ELSE 0 END) as chow_count,
      SUM(CASE WHEN d.deal_type = 'sale' THEN 1 ELSE 0 END) as sale_count,
      SUM(CASE WHEN d.deal_type IN ('mortgage', 'refinance') THEN 1 ELSE 0 END) as mortgage_count,
      COALESCE(AVG(d.amount), 0) as avg_deal_size,
      COUNT(DISTINCT CASE WHEN dp.party_role = 'buyer' THEN dp.company_id END) as unique_buyers,
      COUNT(DISTINCT CASE WHEN dp.party_role = 'seller' THEN dp.company_id END) as unique_sellers
    FROM deals d
    JOIN property_master pm ON pm.id = d.property_master_id
    LEFT JOIN deals_parties dp ON dp.deal_id = d.id
    ${whereClause}
    GROUP BY pm.state
    HAVING deal_count >= ?
    ORDER BY deal_count DESC
    LIMIT ?
  `, values);

  // Calculate national totals
  const totals = markets.reduce((acc, m) => ({
    deals: acc.deals + m.deal_count,
    amount: acc.amount + Number(m.total_amount),
    properties: acc.properties + m.property_count,
    chow: acc.chow + m.chow_count,
    sale: acc.sale + m.sale_count,
    mortgage: acc.mortgage + m.mortgage_count
  }), { deals: 0, amount: 0, properties: 0, chow: 0, sale: 0, mortgage: 0 });

  return success({
    period_days: days,
    filters: {
      deal_type: deal_type || 'all',
      min_deals
    },
    national_totals: {
      total_deals: totals.deals,
      total_amount: totals.amount,
      unique_properties: totals.properties,
      by_type: {
        chow: totals.chow,
        sale: totals.sale,
        mortgage: totals.mortgage
      }
    },
    markets: markets.map((m, idx) => ({
      rank: idx + 1,
      state: m.state,
      deal_count: m.deal_count,
      market_share: totals.deals > 0 ? Math.round((m.deal_count / totals.deals) * 100 * 10) / 10 : 0,
      total_amount: Number(m.total_amount),
      property_count: m.property_count,
      avg_deal_size: Math.round(Number(m.avg_deal_size)),
      deal_breakdown: {
        chow: m.chow_count,
        sale: m.sale_count,
        mortgage: m.mortgage_count
      },
      market_depth: {
        unique_buyers: m.unique_buyers,
        unique_sellers: m.unique_sellers
      }
    }))
  });
}

export const definition = {
  name: 'get_hot_markets',
  description: 'Get state-level market activity rankings. Shows deal volume, amounts, deal type breakdown, and market depth (unique buyers/sellers) per state.',
  inputSchema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Look-back period in days (default 90)' },
      deal_type: { type: 'string', description: 'Filter by deal type (chow, sale, mortgage, etc.)' },
      min_deals: { type: 'number', description: 'Minimum deal count to include state (default 1)' },
      limit: { type: 'number', description: 'Maximum states to return (default 25)' }
    }
  }
};
