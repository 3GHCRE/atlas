/**
 * Tool: get_deal_history
 * Get full transaction history for a property
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Property ID'),
  ccn: z.string().optional().describe('CMS Certification Number')
}).refine(data => data.property_id || data.ccn, {
  message: 'Either property_id or ccn must be provided'
});

export type GetDealHistoryParams = z.infer<typeof schema>;

interface PropertyRow extends RowDataPacket {
  id: number;
  ccn: string;
  facility_name: string;
  city: string;
  state: string;
}

interface DealRow extends RowDataPacket {
  id: number;
  deal_type: string;
  effective_date: Date | null;
  recorded_date: Date | null;
  amount: number | null;
  data_source: string | null;
}

interface PartyRow extends RowDataPacket {
  deal_id: number;
  party_role: string;
  party_name: string;
  company_id: number | null;
  company_name: string | null;
}

interface ChowRow extends RowDataPacket {
  deal_id: number;
  chow_type_code: string | null;
  chow_type_text: string | null;
}

interface SaleRow extends RowDataPacket {
  deal_id: number;
  price_per_bed: number | null;
  cap_rate: number | null;
}

interface MortgageRow extends RowDataPacket {
  deal_id: number;
  loan_type: string | null;
  interest_rate: number | null;
  term_months: number | null;
}

export async function execute(params: GetDealHistoryParams): Promise<ToolResult> {
  const { property_id, ccn } = params;

  if (!property_id && !ccn) {
    return clientError('Either property_id or ccn must be provided');
  }

  // Get property
  let property: PropertyRow | null;
  if (property_id) {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, facility_name, city, state FROM property_master WHERE id = ?`,
      [property_id]
    );
  } else {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, facility_name, city, state FROM property_master WHERE ccn = ?`,
      [ccn]
    );
  }

  if (!property) {
    return notFound('Property', property_id || ccn || '');
  }

  // Get all deals for this property (showcase-navigation.js STEP 2 pattern)
  const deals = await query<DealRow[]>(`
    SELECT id, deal_type, effective_date, recorded_date, amount, data_source
    FROM deals
    WHERE property_master_id = ?
    ORDER BY effective_date DESC
  `, [property.id]);

  // Get all parties
  const parties = await query<PartyRow[]>(`
    SELECT dp.deal_id, dp.party_role, dp.party_name, dp.company_id, c.company_name
    FROM deals_parties dp
    LEFT JOIN companies c ON c.id = dp.company_id
    WHERE dp.deal_id IN (SELECT id FROM deals WHERE property_master_id = ?)
    ORDER BY dp.deal_id, FIELD(dp.party_role, 'buyer', 'seller', 'borrower', 'lender')
  `, [property.id]);

  // Get type-specific details
  const chowDetails = await query<ChowRow[]>(`
    SELECT deal_id, chow_type_code, chow_type_text
    FROM deals_chow WHERE deal_id IN (SELECT id FROM deals WHERE property_master_id = ?)
  `, [property.id]);

  const saleDetails = await query<SaleRow[]>(`
    SELECT deal_id, price_per_bed, cap_rate
    FROM deals_sale WHERE deal_id IN (SELECT id FROM deals WHERE property_master_id = ?)
  `, [property.id]);

  const mortgageDetails = await query<MortgageRow[]>(`
    SELECT deal_id, loan_type, interest_rate, term_months
    FROM deals_mortgage WHERE deal_id IN (SELECT id FROM deals WHERE property_master_id = ?)
  `, [property.id]);

  // Build lookup maps
  const partiesByDeal: Record<number, PartyRow[]> = {};
  for (const p of parties) {
    if (!partiesByDeal[p.deal_id]) partiesByDeal[p.deal_id] = [];
    partiesByDeal[p.deal_id].push(p);
  }

  const chowByDeal = Object.fromEntries(chowDetails.map(c => [c.deal_id, c]));
  const saleByDeal = Object.fromEntries(saleDetails.map(s => [s.deal_id, s]));
  const mortgageByDeal = Object.fromEntries(mortgageDetails.map(m => [m.deal_id, m]));

  return success({
    property: {
      id: property.id,
      ccn: property.ccn,
      facility_name: property.facility_name,
      city: property.city,
      state: property.state
    },
    deal_count: deals.length,
    deals: deals.map(d => {
      const dealParties = partiesByDeal[d.id] || [];
      const chow = chowByDeal[d.id];
      const sale = saleByDeal[d.id];
      const mortgage = mortgageByDeal[d.id];

      return {
        id: d.id,
        deal_type: d.deal_type,
        effective_date: d.effective_date,
        recorded_date: d.recorded_date,
        amount: d.amount,
        data_source: d.data_source,
        parties: dealParties.map(p => ({
          role: p.party_role,
          name: p.party_name,
          company_id: p.company_id,
          company_name: p.company_name
        })),
        ...(chow ? {
          chow_details: {
            type_code: chow.chow_type_code,
            type_text: chow.chow_type_text
          }
        } : {}),
        ...(sale ? {
          sale_details: {
            price_per_bed: sale.price_per_bed,
            cap_rate: sale.cap_rate
          }
        } : {}),
        ...(mortgage ? {
          mortgage_details: {
            loan_type: mortgage.loan_type,
            interest_rate: mortgage.interest_rate,
            term_months: mortgage.term_months
          }
        } : {})
      };
    })
  });
}

export const definition = {
  name: 'get_deal_history',
  description: 'Get complete transaction history for a property, including sales, CHOWs (change of ownership), and mortgages with all parties involved',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Property ID' },
      ccn: { type: 'string', description: 'CMS Certification Number' }
    }
  }
};
