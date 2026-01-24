/**
 * Tool: get_deal
 * Get deal by ID with parties and type-specific details
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  id: z.number().describe('Deal ID')
});

export type GetDealParams = z.infer<typeof schema>;

interface DealRow extends RowDataPacket {
  id: number;
  property_master_id: number;
  ccn: string;
  facility_name: string;
  deal_type: string;
  effective_date: Date | null;
  recorded_date: Date | null;
  amount: number | null;
  document_id: string | null;
  data_source: string | null;
}

interface PartyRow extends RowDataPacket {
  party_role: string;
  party_name: string;
  party_dba_name: string | null;
  company_id: number | null;
  company_name: string | null;
  principal_id: number | null;
}

interface ChowRow extends RowDataPacket {
  chow_type_code: string | null;
  chow_type_text: string | null;
  buyer_enrollment_id: string | null;
  seller_enrollment_id: string | null;
}

interface SaleRow extends RowDataPacket {
  sale_type: string | null;
  price_per_bed: number | null;
  price_per_sqft: number | null;
  bed_count: number | null;
  cap_rate: number | null;
}

interface MortgageRow extends RowDataPacket {
  loan_type: string | null;
  term_months: number | null;
  interest_rate: number | null;
  maturity_date: Date | null;
}

export async function execute(params: GetDealParams): Promise<ToolResult> {
  const { id } = params;

  if (!id) {
    return missingParam('id');
  }

  // Get deal with property info
  const deal = await queryOne<DealRow>(`
    SELECT d.id, d.property_master_id, d.ccn, pm.facility_name,
           d.deal_type, d.effective_date, d.recorded_date,
           d.amount, d.document_id, d.data_source
    FROM deals d
    LEFT JOIN property_master pm ON pm.id = d.property_master_id
    WHERE d.id = ?
  `, [id]);

  if (!deal) {
    return notFound('Deal', id);
  }

  // Get deal parties
  const parties = await query<PartyRow[]>(`
    SELECT dp.party_role, dp.party_name, dp.party_dba_name,
           dp.company_id, c.company_name, dp.principal_id
    FROM deals_parties dp
    LEFT JOIN companies c ON c.id = dp.company_id
    WHERE dp.deal_id = ?
    ORDER BY FIELD(dp.party_role, 'buyer', 'seller', 'borrower', 'lender')
  `, [id]);

  // Get type-specific details
  let typeDetails: Record<string, unknown> = {};

  if (deal.deal_type === 'chow') {
    const chow = await queryOne<ChowRow>(`
      SELECT chow_type_code, chow_type_text, buyer_enrollment_id, seller_enrollment_id
      FROM deals_chow WHERE deal_id = ?
    `, [id]);
    if (chow) {
      typeDetails = {
        chow_type_code: chow.chow_type_code,
        chow_type_text: chow.chow_type_text,
        buyer_enrollment_id: chow.buyer_enrollment_id,
        seller_enrollment_id: chow.seller_enrollment_id
      };
    }
  } else if (deal.deal_type === 'sale') {
    const sale = await queryOne<SaleRow>(`
      SELECT sale_type, price_per_bed, price_per_sqft, bed_count, cap_rate
      FROM deals_sale WHERE deal_id = ?
    `, [id]);
    if (sale) {
      typeDetails = {
        sale_type: sale.sale_type,
        price_per_bed: sale.price_per_bed,
        price_per_sqft: sale.price_per_sqft,
        bed_count: sale.bed_count,
        cap_rate: sale.cap_rate
      };
    }
  } else if (deal.deal_type === 'mortgage') {
    const mortgage = await queryOne<MortgageRow>(`
      SELECT loan_type, term_months, interest_rate, maturity_date
      FROM deals_mortgage WHERE deal_id = ?
    `, [id]);
    if (mortgage) {
      typeDetails = {
        loan_type: mortgage.loan_type,
        term_months: mortgage.term_months,
        interest_rate: mortgage.interest_rate,
        maturity_date: mortgage.maturity_date
      };
    }
  }

  return success({
    deal: {
      id: deal.id,
      deal_type: deal.deal_type,
      effective_date: deal.effective_date,
      recorded_date: deal.recorded_date,
      amount: deal.amount,
      document_id: deal.document_id,
      data_source: deal.data_source
    },
    property: {
      id: deal.property_master_id,
      ccn: deal.ccn,
      facility_name: deal.facility_name
    },
    parties: parties.map(p => ({
      role: p.party_role,
      name: p.party_name,
      dba_name: p.party_dba_name,
      company_id: p.company_id,
      company_name: p.company_name,
      principal_id: p.principal_id
    })),
    type_details: typeDetails
  });
}

export const definition = {
  name: 'get_deal',
  description: 'Get transaction/deal by ID, including property, parties (buyer/seller/lender), and type-specific details (CHOW, sale, mortgage)',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Deal ID' }
    },
    required: ['id']
  }
};
