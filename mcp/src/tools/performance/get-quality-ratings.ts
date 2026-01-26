/**
 * Tool: get_quality_ratings
 * Get CMS quality/star ratings for a property (current and historical)
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Property ID'),
  ccn: z.string().optional().describe('CMS Certification Number (6-digit)'),
  include_history: z.boolean().optional().default(false).describe('Include historical ratings (default: current only)'),
  limit: z.number().optional().default(12).describe('Max historical periods to return (default 12)')
}).refine(data => data.property_id || data.ccn, {
  message: 'Either property_id or ccn must be provided'
});

export type GetQualityRatingsParams = z.infer<typeof schema>;

interface QualityRow extends RowDataPacket {
  property_master_id: number;
  ccn: string;
  facility_name: string;
  state: string;
  rating_date: Date;
  overall_rating: number | null;
  health_inspection_rating: number | null;
  staffing_rating: number | null;
  quality_measure_rating: number | null;
  rn_staffing_rating: number | null;
  long_stay_qm_rating: number | null;
  short_stay_qm_rating: number | null;
  special_focus_facility: string | null;
  abuse_icon: boolean;
  recent_ownership_change: boolean;
  total_weighted_health_survey_score: number | null;
  number_of_facility_reported_incidents: number;
  number_of_substantiated_complaints: number;
  number_of_fines: number;
  total_fines_dollars: number;
  number_of_payment_denials: number;
  total_penalties: number;
  certified_beds: number | null;
  average_residents_per_day: number | null;
}

export async function execute(params: GetQualityRatingsParams): Promise<ToolResult> {
  const { property_id, ccn, include_history, limit } = params;

  if (!property_id && !ccn) {
    return clientError('Either property_id or ccn must be provided');
  }

  // Build WHERE clause
  const whereClause = property_id
    ? 'pm.id = ?'
    : 'pm.ccn = ?';
  const whereValue = property_id || ccn;

  // Get ratings
  const sql = include_history
    ? `SELECT pm.id as property_master_id, pm.ccn, pm.facility_name, pm.state,
              qr.rating_date, qr.overall_rating, qr.health_inspection_rating,
              qr.staffing_rating, qr.quality_measure_rating, qr.rn_staffing_rating,
              qr.long_stay_qm_rating, qr.short_stay_qm_rating,
              qr.special_focus_facility, qr.abuse_icon, qr.recent_ownership_change,
              qr.total_weighted_health_survey_score,
              qr.number_of_facility_reported_incidents, qr.number_of_substantiated_complaints,
              qr.number_of_fines, qr.total_fines_dollars, qr.number_of_payment_denials,
              qr.total_penalties, qr.certified_beds, qr.average_residents_per_day
       FROM property_master pm
       JOIN quality_ratings qr ON qr.property_master_id = pm.id
       WHERE ${whereClause}
       ORDER BY qr.rating_date DESC
       LIMIT ?`
    : `SELECT pm.id as property_master_id, pm.ccn, pm.facility_name, pm.state,
              qr.rating_date, qr.overall_rating, qr.health_inspection_rating,
              qr.staffing_rating, qr.quality_measure_rating, qr.rn_staffing_rating,
              qr.long_stay_qm_rating, qr.short_stay_qm_rating,
              qr.special_focus_facility, qr.abuse_icon, qr.recent_ownership_change,
              qr.total_weighted_health_survey_score,
              qr.number_of_facility_reported_incidents, qr.number_of_substantiated_complaints,
              qr.number_of_fines, qr.total_fines_dollars, qr.number_of_payment_denials,
              qr.total_penalties, qr.certified_beds, qr.average_residents_per_day
       FROM property_master pm
       JOIN quality_ratings qr ON qr.property_master_id = pm.id
       WHERE ${whereClause}
         AND qr.rating_date = (SELECT MAX(rating_date) FROM quality_ratings WHERE property_master_id = pm.id)`;

  const queryParams = include_history ? [whereValue, limit] : [whereValue];
  const ratings = await query<QualityRow[]>(sql, queryParams);

  if (ratings.length === 0) {
    return notFound('Quality ratings for property', property_id || ccn || '');
  }

  const facility = {
    property_id: ratings[0].property_master_id,
    ccn: ratings[0].ccn,
    facility_name: ratings[0].facility_name,
    state: ratings[0].state
  };

  const formattedRatings = ratings.map(r => ({
    rating_date: r.rating_date,
    star_ratings: {
      overall: r.overall_rating,
      health_inspection: r.health_inspection_rating,
      staffing: r.staffing_rating,
      quality_measure: r.quality_measure_rating,
      rn_staffing: r.rn_staffing_rating,
      long_stay_qm: r.long_stay_qm_rating,
      short_stay_qm: r.short_stay_qm_rating
    },
    flags: {
      special_focus_facility: r.special_focus_facility,
      abuse_icon: r.abuse_icon,
      recent_ownership_change: r.recent_ownership_change
    },
    survey: {
      weighted_health_score: r.total_weighted_health_survey_score,
      facility_reported_incidents: r.number_of_facility_reported_incidents,
      substantiated_complaints: r.number_of_substantiated_complaints
    },
    penalties: {
      number_of_fines: r.number_of_fines,
      total_fines_dollars: r.total_fines_dollars,
      payment_denials: r.number_of_payment_denials,
      total_penalties: r.total_penalties
    },
    census: {
      certified_beds: r.certified_beds,
      average_residents_per_day: r.average_residents_per_day
    }
  }));

  return success({
    facility,
    current_rating: formattedRatings[0],
    history: include_history ? formattedRatings : undefined,
    periods_returned: formattedRatings.length
  });
}

export const definition = {
  name: 'get_quality_ratings',
  description: 'Get CMS quality/star ratings for a SNF property including overall rating, health inspection, staffing, quality measures, SFF status, penalties, and certified bed count. Supports historical data.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Property ID' },
      ccn: { type: 'string', description: 'CMS Certification Number (6-digit)' },
      include_history: { type: 'boolean', description: 'Include historical ratings (default: current only)' },
      limit: { type: 'number', description: 'Max historical periods to return (default 12)' }
    }
  }
};
