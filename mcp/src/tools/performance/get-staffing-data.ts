/**
 * Tool: get_staffing_data
 * Get CMS PBJ staffing data for a property (current and historical)
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Property ID'),
  ccn: z.string().optional().describe('CMS Certification Number (6-digit)'),
  include_history: z.boolean().optional().default(false).describe('Include historical quarters (default: current only)'),
  limit: z.number().optional().default(8).describe('Max historical quarters to return (default 8)')
}).refine(data => data.property_id || data.ccn, {
  message: 'Either property_id or ccn must be provided'
});

export type GetStaffingDataParams = z.infer<typeof schema>;

interface StaffingRow extends RowDataPacket {
  property_master_id: number;
  ccn: string;
  facility_name: string;
  state: string;
  report_quarter: Date;
  cna_hprd: number | null;
  lpn_hprd: number | null;
  rn_hprd: number | null;
  total_nurse_hprd: number | null;
  licensed_staff_hprd: number | null;
  physical_therapist_hprd: number | null;
  total_nurse_hours: number | null;
  rn_hours: number | null;
  lpn_hours: number | null;
  cna_hours: number | null;
  pt_hours: number | null;
  staffing_rating: number | null;
  rn_staffing_rating: number | null;
  weekend_staffing_deviation: number | null;
  staff_turnover_rate: number | null;
  rn_turnover_rate: number | null;
  average_daily_census: number | null;
}

export async function execute(params: GetStaffingDataParams): Promise<ToolResult> {
  const { property_id, ccn, include_history, limit } = params;

  if (!property_id && !ccn) {
    return clientError('Either property_id or ccn must be provided');
  }

  // Build WHERE clause
  const whereClause = property_id
    ? 'pm.id = ?'
    : 'pm.ccn = ?';
  const whereValue = property_id || ccn;

  // Get staffing data
  const sql = include_history
    ? `SELECT pm.id as property_master_id, pm.ccn, pm.facility_name, pm.state,
              sd.report_quarter, sd.cna_hprd, sd.lpn_hprd, sd.rn_hprd,
              sd.total_nurse_hprd, sd.licensed_staff_hprd, sd.physical_therapist_hprd,
              sd.total_nurse_hours, sd.rn_hours, sd.lpn_hours, sd.cna_hours, sd.pt_hours,
              sd.staffing_rating, sd.rn_staffing_rating,
              sd.weekend_staffing_deviation, sd.staff_turnover_rate, sd.rn_turnover_rate,
              sd.average_daily_census
       FROM property_master pm
       JOIN staffing_data sd ON sd.property_master_id = pm.id
       WHERE ${whereClause}
       ORDER BY sd.report_quarter DESC
       LIMIT ?`
    : `SELECT pm.id as property_master_id, pm.ccn, pm.facility_name, pm.state,
              sd.report_quarter, sd.cna_hprd, sd.lpn_hprd, sd.rn_hprd,
              sd.total_nurse_hprd, sd.licensed_staff_hprd, sd.physical_therapist_hprd,
              sd.total_nurse_hours, sd.rn_hours, sd.lpn_hours, sd.cna_hours, sd.pt_hours,
              sd.staffing_rating, sd.rn_staffing_rating,
              sd.weekend_staffing_deviation, sd.staff_turnover_rate, sd.rn_turnover_rate,
              sd.average_daily_census
       FROM property_master pm
       JOIN staffing_data sd ON sd.property_master_id = pm.id
       WHERE ${whereClause}
         AND sd.report_quarter = (SELECT MAX(report_quarter) FROM staffing_data WHERE property_master_id = pm.id)`;

  const queryParams = include_history ? [whereValue, limit] : [whereValue];
  const staffing = await query<StaffingRow[]>(sql, queryParams);

  if (staffing.length === 0) {
    return notFound('Staffing data for property', property_id || ccn || '');
  }

  const facility = {
    property_id: staffing[0].property_master_id,
    ccn: staffing[0].ccn,
    facility_name: staffing[0].facility_name,
    state: staffing[0].state
  };

  const formattedStaffing = staffing.map(s => ({
    report_quarter: s.report_quarter,
    hours_per_resident_day: {
      cna: s.cna_hprd,
      lpn: s.lpn_hprd,
      rn: s.rn_hprd,
      total_nurse: s.total_nurse_hprd,
      licensed_staff: s.licensed_staff_hprd,
      physical_therapist: s.physical_therapist_hprd
    },
    total_hours: {
      total_nurse: s.total_nurse_hours,
      rn: s.rn_hours,
      lpn: s.lpn_hours,
      cna: s.cna_hours,
      pt: s.pt_hours
    },
    ratings: {
      staffing: s.staffing_rating,
      rn_staffing: s.rn_staffing_rating
    },
    workforce_metrics: {
      weekend_staffing_deviation: s.weekend_staffing_deviation,
      staff_turnover_rate: s.staff_turnover_rate,
      rn_turnover_rate: s.rn_turnover_rate
    },
    census: {
      average_daily: s.average_daily_census
    }
  }));

  return success({
    facility,
    current_staffing: formattedStaffing[0],
    history: include_history ? formattedStaffing : undefined,
    quarters_returned: formattedStaffing.length
  });
}

export const definition = {
  name: 'get_staffing_data',
  description: 'Get CMS PBJ staffing data for a SNF property including hours per resident day (HPRD), staffing ratings, turnover rates, and census. Supports historical quarterly data.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Property ID' },
      ccn: { type: 'string', description: 'CMS Certification Number (6-digit)' },
      include_history: { type: 'boolean', description: 'Include historical quarters (default: current only)' },
      limit: { type: 'number', description: 'Max historical quarters to return (default 8)' }
    }
  }
};
