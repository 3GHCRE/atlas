/**
 * Tool: search_deals
 * Search/filter deals with various criteria
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Filter by property ID'),
  ccn: z.string().optional().describe('Filter by CCN'),
  deal_type: z.string().optional().describe('Deal type (chow, sale, mortgage)'),
  date_from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
  date_to: z.string().optional().describe('End date (YYYY-MM-DD)'),
  company_id: z.number().optional().describe('Filter by company involved in deal'),
  state: z.string().optional().describe('State code of property'),
  min_amount: z.number().optional().describe('Minimum deal amount'),
  limit: z.number().min(1).max(100).default(25).describe('Maximum results (default 25, max 100)')
});

export type SearchDealsParams = z.infer<typeof schema>;

interface DealRow extends RowDataPacket {
  id: number;
  ccn: string;
  facility_name: string;
  city: string;
  state: string;
  deal_type: string;
  effective_date: Date | null;
  amount: number | null;
  buyer_name: string | null;
  seller_name: string | null;
}

export async function execute(params: SearchDealsParams): Promise<ToolResult> {
  const { property_id, ccn, deal_type, date_from, date_to, company_id, state, min_amount, limit = 25 } = params;

  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (property_id) {
    conditions.push('d.property_master_id = ?');
    values.push(property_id);
  }

  if (ccn) {
    conditions.push('d.ccn = ?');
    values.push(ccn);
  }

  if (deal_type) {
    conditions.push('d.deal_type = ?');
    values.push(deal_type);
  }

  if (date_from) {
    conditions.push('d.effective_date >= ?');
    values.push(date_from);
  }

  if (date_to) {
    conditions.push('d.effective_date <= ?');
    values.push(date_to);
  }

  if (state) {
    conditions.push('pm.state = ?');
    values.push(state.toUpperCase());
  }

  if (min_amount) {
    conditions.push('d.amount >= ?');
    values.push(min_amount);
  }

  if (company_id) {
    conditions.push(`EXISTS (
      SELECT 1 FROM deals_parties dp
      WHERE dp.deal_id = d.id AND dp.company_id = ?
    )`);
    values.push(company_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit);

  const deals = await query<DealRow[]>(`
    SELECT d.id, d.ccn, pm.facility_name, pm.city, pm.state,
           d.deal_type, d.effective_date, d.amount,
           dp_buyer.party_name as buyer_name,
           dp_seller.party_name as seller_name
    FROM deals d
    LEFT JOIN property_master pm ON pm.id = d.property_master_id
    LEFT JOIN deals_parties dp_buyer ON dp_buyer.deal_id = d.id AND dp_buyer.party_role = 'buyer'
    LEFT JOIN deals_parties dp_seller ON dp_seller.deal_id = d.id AND dp_seller.party_role = 'seller'
    ${whereClause}
    ORDER BY d.effective_date DESC
    LIMIT ?
  `, values);

  return success({
    count: deals.length,
    deals: deals.map(d => ({
      id: d.id,
      ccn: d.ccn,
      facility_name: d.facility_name,
      city: d.city,
      state: d.state,
      deal_type: d.deal_type,
      effective_date: d.effective_date,
      amount: d.amount,
      buyer: d.buyer_name,
      seller: d.seller_name
    }))
  });
}

export const definition = {
  name: 'search_deals',
  description: 'Search transactions/deals by property, type (chow/sale/mortgage), date range, company, or amount. Returns deal summary with buyer/seller.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Filter by property ID' },
      ccn: { type: 'string', description: 'Filter by CCN' },
      deal_type: { type: 'string', description: 'Deal type (chow, sale, mortgage)' },
      date_from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
      date_to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      company_id: { type: 'number', description: 'Filter by company involved in deal' },
      state: { type: 'string', description: 'State code of property' },
      min_amount: { type: 'number', description: 'Minimum deal amount' },
      limit: { type: 'number', description: 'Maximum results (default 25, max 100)' }
    }
  }
};
