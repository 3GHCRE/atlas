/**
 * Tool: get_medicaid_rates
 * Get Medicaid reimbursement rates for a property (current and historical)
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Property ID'),
  ccn: z.string().optional().describe('CMS Certification Number (6-digit)'),
  include_history: z.boolean().optional().default(false).describe('Include historical rates (default: current only)'),
  limit: z.number().optional().default(12).describe('Max historical rate periods to return (default 12)')
}).refine(data => data.property_id || data.ccn, {
  message: 'Either property_id or ccn must be provided'
});

export type GetMedicaidRatesParams = z.infer<typeof schema>;

interface MedicaidRateRow extends RowDataPacket {
  property_master_id: number;
  ccn: string;
  facility_name: string;
  pm_state: string;
  rate_id: number;
  rate_state: string;
  state_facility_id: string | null;
  daily_rate: number;
  rate_type: string;
  rate_component: string | null;
  effective_date: Date;
  end_date: Date | null;
  rate_period: string | null;
  data_source: string;
  verified: boolean;
}

interface StateStatsRow extends RowDataPacket {
  state: string;
  avg_rate: number;
  min_rate: number;
  max_rate: number;
  facility_count: number;
}

export async function execute(params: GetMedicaidRatesParams): Promise<ToolResult> {
  const { property_id, ccn, include_history, limit } = params;

  if (!property_id && !ccn) {
    return clientError('Either property_id or ccn must be provided');
  }

  // Build WHERE clause
  const whereClause = property_id
    ? 'pm.id = ?'
    : 'pm.ccn = ?';
  const whereValue = property_id || ccn;

  // Get medicaid rates
  const sql = include_history
    ? `SELECT pm.id as property_master_id, pm.ccn, pm.facility_name, pm.state as pm_state,
              mr.id as rate_id, mr.state as rate_state, mr.state_facility_id,
              mr.daily_rate, mr.rate_type, mr.rate_component,
              mr.effective_date, mr.end_date, mr.rate_period,
              mr.data_source, mr.verified
       FROM property_master pm
       JOIN medicaid_rates mr ON mr.property_master_id = pm.id
       WHERE ${whereClause}
       ORDER BY mr.effective_date DESC
       LIMIT ?`
    : `SELECT pm.id as property_master_id, pm.ccn, pm.facility_name, pm.state as pm_state,
              mr.id as rate_id, mr.state as rate_state, mr.state_facility_id,
              mr.daily_rate, mr.rate_type, mr.rate_component,
              mr.effective_date, mr.end_date, mr.rate_period,
              mr.data_source, mr.verified
       FROM property_master pm
       JOIN medicaid_rates mr ON mr.property_master_id = pm.id
       WHERE ${whereClause}
         AND mr.end_date IS NULL
       ORDER BY mr.effective_date DESC`;

  const queryParams = include_history ? [whereValue, limit] : [whereValue];
  const rates = await query<MedicaidRateRow[]>(sql, queryParams);

  if (rates.length === 0) {
    return notFound('Medicaid rates for property', property_id || ccn || '');
  }

  const facility = {
    property_id: rates[0].property_master_id,
    ccn: rates[0].ccn,
    facility_name: rates[0].facility_name,
    state: rates[0].pm_state
  };

  // Get state comparison stats for context
  const stateStats = await query<StateStatsRow[]>(`
    SELECT state,
           ROUND(AVG(daily_rate), 2) as avg_rate,
           MIN(daily_rate) as min_rate,
           MAX(daily_rate) as max_rate,
           COUNT(DISTINCT property_master_id) as facility_count
    FROM medicaid_rates
    WHERE state = ? AND end_date IS NULL
    GROUP BY state
  `, [rates[0].pm_state]);

  const formattedRates = rates.map(r => ({
    effective_date: r.effective_date,
    end_date: r.end_date,
    rate_period: r.rate_period,
    daily_rate: r.daily_rate,
    rate_type: r.rate_type,
    rate_component: r.rate_component,
    state_facility_id: r.state_facility_id,
    data_source: r.data_source,
    verified: r.verified,
    is_current: r.end_date === null
  }));

  const currentRate = formattedRates.find(r => r.is_current) || formattedRates[0];

  return success({
    facility,
    current_rate: currentRate,
    state_comparison: stateStats.length > 0 ? {
      state: stateStats[0].state,
      avg_rate: stateStats[0].avg_rate,
      min_rate: stateStats[0].min_rate,
      max_rate: stateStats[0].max_rate,
      facility_count: stateStats[0].facility_count,
      facility_vs_avg: currentRate
        ? Math.round((currentRate.daily_rate / stateStats[0].avg_rate - 1) * 100 * 10) / 10
        : null
    } : null,
    history: include_history ? formattedRates : undefined,
    periods_returned: formattedRates.length
  });
}

export const definition = {
  name: 'get_medicaid_rates',
  description: 'Get Medicaid reimbursement rates ($/day) for a SNF property with state comparison context. Supports historical rate data.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Property ID' },
      ccn: { type: 'string', description: 'CMS Certification Number (6-digit)' },
      include_history: { type: 'boolean', description: 'Include historical rates (default: current only)' },
      limit: { type: 'number', description: 'Max historical rate periods to return (default 12)' }
    }
  }
};
