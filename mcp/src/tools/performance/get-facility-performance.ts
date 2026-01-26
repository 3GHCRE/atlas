/**
 * Tool: get_facility_performance
 * Get combined performance summary for a property (quality, staffing, financial, rates)
 */
import { z } from 'zod';
import { queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Property ID'),
  ccn: z.string().optional().describe('CMS Certification Number (6-digit)')
}).refine(data => data.property_id || data.ccn, {
  message: 'Either property_id or ccn must be provided'
});

export type GetFacilityPerformanceParams = z.infer<typeof schema>;

interface PerformanceRow extends RowDataPacket {
  property_master_id: number;
  ccn: string;
  facility_name: string;
  state: string;
  city: string;
  // Quality
  quality_date: Date | null;
  overall_rating: number | null;
  health_inspection_rating: number | null;
  staffing_rating: number | null;
  quality_measure_rating: number | null;
  special_focus_facility: string | null;
  abuse_icon: boolean | null;
  total_penalties: number | null;
  total_fines_dollars: number | null;
  certified_beds: number | null;
  // Staffing
  staffing_quarter: Date | null;
  total_nurse_hprd: number | null;
  rn_hprd: number | null;
  cna_hprd: number | null;
  staff_turnover_rate: number | null;
  // Financial
  fiscal_year: number | null;
  net_patient_revenue: number | null;
  operating_margin: number | null;
  occupancy_rate: number | null;
  medicaid_pct: number | null;
  medicare_pct: number | null;
  cost_per_patient_day: number | null;
  // Medicaid Rate
  medicaid_daily_rate: number | null;
  rate_effective_date: Date | null;
}

export async function execute(params: GetFacilityPerformanceParams): Promise<ToolResult> {
  const { property_id, ccn } = params;

  if (!property_id && !ccn) {
    return clientError('Either property_id or ccn must be provided');
  }

  // Build WHERE clause
  const whereClause = property_id
    ? 'pm.id = ?'
    : 'pm.ccn = ?';
  const whereValue = property_id || ccn;

  // Get combined performance data (similar to v_facility_performance view)
  const performance = await queryOne<PerformanceRow>(`
    SELECT
      pm.id AS property_master_id,
      pm.ccn,
      pm.facility_name,
      pm.state,
      pm.city,

      -- Quality (Latest)
      qr.rating_date AS quality_date,
      qr.overall_rating,
      qr.health_inspection_rating,
      qr.staffing_rating,
      qr.quality_measure_rating,
      qr.special_focus_facility,
      qr.abuse_icon,
      qr.total_penalties,
      qr.total_fines_dollars,
      qr.certified_beds,

      -- Staffing (Latest)
      sd.report_quarter AS staffing_quarter,
      sd.total_nurse_hprd,
      sd.rn_hprd,
      sd.cna_hprd,
      sd.staff_turnover_rate,

      -- Financial (Latest)
      cr.fiscal_year,
      cr.net_patient_revenue,
      cr.operating_margin,
      cr.occupancy_rate,
      cr.medicaid_pct,
      cr.medicare_pct,
      cr.cost_per_patient_day,

      -- Medicaid Rate (Latest)
      mr.daily_rate AS medicaid_daily_rate,
      mr.effective_date AS rate_effective_date

    FROM property_master pm

    LEFT JOIN quality_ratings qr ON qr.property_master_id = pm.id
      AND qr.rating_date = (SELECT MAX(rating_date) FROM quality_ratings WHERE property_master_id = pm.id)

    LEFT JOIN staffing_data sd ON sd.property_master_id = pm.id
      AND sd.report_quarter = (SELECT MAX(report_quarter) FROM staffing_data WHERE property_master_id = pm.id)

    LEFT JOIN cost_reports cr ON cr.property_master_id = pm.id
      AND cr.fiscal_year = (SELECT MAX(fiscal_year) FROM cost_reports WHERE property_master_id = pm.id)

    LEFT JOIN medicaid_rates mr ON mr.property_master_id = pm.id
      AND mr.end_date IS NULL
      AND mr.effective_date = (SELECT MAX(effective_date) FROM medicaid_rates WHERE property_master_id = pm.id AND end_date IS NULL)

    WHERE ${whereClause}
  `, [whereValue]);

  if (!performance) {
    return notFound('Property', property_id || ccn || '');
  }

  // Determine data availability
  const dataAvailability = {
    quality: performance.quality_date !== null,
    staffing: performance.staffing_quarter !== null,
    financial: performance.fiscal_year !== null,
    medicaid_rate: performance.medicaid_daily_rate !== null
  };

  return success({
    facility: {
      property_id: performance.property_master_id,
      ccn: performance.ccn,
      facility_name: performance.facility_name,
      city: performance.city,
      state: performance.state,
      certified_beds: performance.certified_beds
    },
    quality: dataAvailability.quality ? {
      as_of: performance.quality_date,
      overall_rating: performance.overall_rating,
      health_inspection_rating: performance.health_inspection_rating,
      staffing_rating: performance.staffing_rating,
      quality_measure_rating: performance.quality_measure_rating,
      special_focus_facility: performance.special_focus_facility,
      abuse_icon: performance.abuse_icon,
      total_penalties: performance.total_penalties,
      total_fines_dollars: performance.total_fines_dollars
    } : null,
    staffing: dataAvailability.staffing ? {
      as_of: performance.staffing_quarter,
      total_nurse_hprd: performance.total_nurse_hprd,
      rn_hprd: performance.rn_hprd,
      cna_hprd: performance.cna_hprd,
      staff_turnover_rate: performance.staff_turnover_rate
    } : null,
    financial: dataAvailability.financial ? {
      fiscal_year: performance.fiscal_year,
      net_patient_revenue: performance.net_patient_revenue,
      operating_margin: performance.operating_margin,
      occupancy_rate: performance.occupancy_rate,
      medicaid_pct: performance.medicaid_pct,
      medicare_pct: performance.medicare_pct,
      cost_per_patient_day: performance.cost_per_patient_day
    } : null,
    medicaid_rate: dataAvailability.medicaid_rate ? {
      effective_date: performance.rate_effective_date,
      daily_rate: performance.medicaid_daily_rate
    } : null,
    data_availability: dataAvailability
  });
}

export const definition = {
  name: 'get_facility_performance',
  description: 'Get combined performance summary for a SNF property including latest quality ratings, staffing metrics, financial data, and Medicaid rates in a single call.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Property ID' },
      ccn: { type: 'string', description: 'CMS Certification Number (6-digit)' }
    }
  }
};
