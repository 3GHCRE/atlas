/**
 * Tool: get_deal_parties
 * Get all participants in a deal with their roles and company linkages
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  deal_id: z.number().describe('Deal ID')
});

export type GetDealPartiesParams = z.infer<typeof schema>;

interface DealRow extends RowDataPacket {
  id: number;
  deal_type: string;
  effective_date: Date | null;
  amount: number | null;
  ccn: string;
  facility_name: string;
}

interface PartyRow extends RowDataPacket {
  id: number;
  party_role: string;
  party_name: string;
  party_dba_name: string | null;
  company_id: number | null;
  company_name: string | null;
  company_type: string | null;
  principal_id: number | null;
  principal_name: string | null;
  entity_id: number | null;
  entity_name: string | null;
  enrollment_id: string | null;
  associate_id: string | null;
}

export async function execute(params: GetDealPartiesParams): Promise<ToolResult> {
  const { deal_id } = params;

  if (!deal_id) {
    return missingParam('deal_id');
  }

  // Get deal info
  const deal = await queryOne<DealRow>(`
    SELECT d.id, d.deal_type, d.effective_date, d.amount, d.ccn, pm.facility_name
    FROM deals d
    LEFT JOIN property_master pm ON pm.id = d.property_master_id
    WHERE d.id = ?
  `, [deal_id]);

  if (!deal) {
    return notFound('Deal', deal_id);
  }

  // Get all parties with full resolution
  const parties = await query<PartyRow[]>(`
    SELECT dp.id, dp.party_role, dp.party_name, dp.party_dba_name,
           dp.company_id, c.company_name, c.company_type,
           dp.principal_id, p.full_name as principal_name,
           dp.entity_id, e.entity_name,
           dp.enrollment_id, dp.associate_id
    FROM deals_parties dp
    LEFT JOIN companies c ON c.id = dp.company_id
    LEFT JOIN principals p ON p.id = dp.principal_id
    LEFT JOIN entities e ON e.id = dp.entity_id
    WHERE dp.deal_id = ?
    ORDER BY FIELD(dp.party_role, 'buyer', 'seller', 'borrower', 'lender', 'assignor', 'assignee')
  `, [deal_id]);

  // Group parties by role
  const byRole: Record<string, PartyRow[]> = {};
  for (const p of parties) {
    if (!byRole[p.party_role]) byRole[p.party_role] = [];
    byRole[p.party_role].push(p);
  }

  return success({
    deal: {
      id: deal.id,
      deal_type: deal.deal_type,
      effective_date: deal.effective_date,
      amount: deal.amount,
      property: {
        ccn: deal.ccn,
        facility_name: deal.facility_name
      }
    },
    party_count: parties.length,
    parties_by_role: Object.fromEntries(
      Object.entries(byRole).map(([role, ps]) => [
        role,
        ps.map(p => ({
          id: p.id,
          name: p.party_name,
          dba_name: p.party_dba_name,
          company: p.company_id ? {
            id: p.company_id,
            name: p.company_name,
            type: p.company_type
          } : null,
          principal: p.principal_id ? {
            id: p.principal_id,
            name: p.principal_name
          } : null,
          entity: p.entity_id ? {
            id: p.entity_id,
            name: p.entity_name
          } : null,
          identifiers: {
            enrollment_id: p.enrollment_id,
            associate_id: p.associate_id
          }
        }))
      ])
    ),
    all_parties: parties.map(p => ({
      role: p.party_role,
      name: p.party_name,
      dba_name: p.party_dba_name,
      company_id: p.company_id,
      company_name: p.company_name,
      principal_id: p.principal_id,
      entity_id: p.entity_id
    }))
  });
}

export const definition = {
  name: 'get_deal_parties',
  description: 'Get all participants in a transaction, grouped by role (buyer/seller/lender/etc), with linked company and principal information',
  inputSchema: {
    type: 'object',
    properties: {
      deal_id: { type: 'number', description: 'Deal ID' }
    },
    required: ['deal_id']
  }
};
