/**
 * Tool: get_cost_reports
 * Get CMS HCRIS cost report data for a property (current and historical)
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  property_id: z.number().optional().describe('Property ID'),
  ccn: z.string().optional().describe('CMS Certification Number (6-digit)'),
  include_history: z.boolean().optional().default(false).describe('Include historical fiscal years (default: current only)'),
  limit: z.number().optional().default(5).describe('Max historical years to return (default 5)')
}).refine(data => data.property_id || data.ccn, {
  message: 'Either property_id or ccn must be provided'
});

export type GetCostReportsParams = z.infer<typeof schema>;

interface CostReportRow extends RowDataPacket {
  property_master_id: number;
  ccn: string;
  facility_name: string;
  state: string;
  fiscal_year_end: Date;
  fiscal_year: number;
  total_patient_revenue: number | null;
  medicare_revenue: number | null;
  medicaid_revenue: number | null;
  private_revenue: number | null;
  other_revenue: number | null;
  net_patient_revenue: number | null;
  total_operating_expenses: number | null;
  salary_wages: number | null;
  employee_benefits: number | null;
  contract_services: number | null;
  supplies: number | null;
  utilities: number | null;
  depreciation: number | null;
  interest_expense: number | null;
  net_income: number | null;
  operating_margin: number | null;
  total_beds: number | null;
  total_patient_days: number | null;
  medicare_days: number | null;
  medicaid_days: number | null;
  private_days: number | null;
  occupancy_rate: number | null;
  medicare_pct: number | null;
  medicaid_pct: number | null;
  private_pct: number | null;
  cost_per_patient_day: number | null;
  nursing_cost_per_day: number | null;
  bad_debt: number | null;
  charity_care: number | null;
}

export async function execute(params: GetCostReportsParams): Promise<ToolResult> {
  const { property_id, ccn, include_history, limit } = params;

  if (!property_id && !ccn) {
    return clientError('Either property_id or ccn must be provided');
  }

  // Build WHERE clause
  const whereClause = property_id
    ? 'pm.id = ?'
    : 'pm.ccn = ?';
  const whereValue = property_id || ccn;

  // Get cost reports
  const sql = include_history
    ? `SELECT pm.id as property_master_id, pm.ccn, pm.facility_name, pm.state,
              cr.fiscal_year_end, cr.fiscal_year,
              cr.total_patient_revenue, cr.medicare_revenue, cr.medicaid_revenue,
              cr.private_revenue, cr.other_revenue, cr.net_patient_revenue,
              cr.total_operating_expenses, cr.salary_wages, cr.employee_benefits,
              cr.contract_services, cr.supplies, cr.utilities, cr.depreciation, cr.interest_expense,
              cr.net_income, cr.operating_margin,
              cr.total_beds, cr.total_patient_days, cr.medicare_days, cr.medicaid_days, cr.private_days,
              cr.occupancy_rate, cr.medicare_pct, cr.medicaid_pct, cr.private_pct,
              cr.cost_per_patient_day, cr.nursing_cost_per_day,
              cr.bad_debt, cr.charity_care
       FROM property_master pm
       JOIN cost_reports cr ON cr.property_master_id = pm.id
       WHERE ${whereClause}
       ORDER BY cr.fiscal_year DESC
       LIMIT ?`
    : `SELECT pm.id as property_master_id, pm.ccn, pm.facility_name, pm.state,
              cr.fiscal_year_end, cr.fiscal_year,
              cr.total_patient_revenue, cr.medicare_revenue, cr.medicaid_revenue,
              cr.private_revenue, cr.other_revenue, cr.net_patient_revenue,
              cr.total_operating_expenses, cr.salary_wages, cr.employee_benefits,
              cr.contract_services, cr.supplies, cr.utilities, cr.depreciation, cr.interest_expense,
              cr.net_income, cr.operating_margin,
              cr.total_beds, cr.total_patient_days, cr.medicare_days, cr.medicaid_days, cr.private_days,
              cr.occupancy_rate, cr.medicare_pct, cr.medicaid_pct, cr.private_pct,
              cr.cost_per_patient_day, cr.nursing_cost_per_day,
              cr.bad_debt, cr.charity_care
       FROM property_master pm
       JOIN cost_reports cr ON cr.property_master_id = pm.id
       WHERE ${whereClause}
         AND cr.fiscal_year = (SELECT MAX(fiscal_year) FROM cost_reports WHERE property_master_id = pm.id)`;

  const queryParams = include_history ? [whereValue, limit] : [whereValue];
  const reports = await query<CostReportRow[]>(sql, queryParams);

  if (reports.length === 0) {
    return notFound('Cost reports for property', property_id || ccn || '');
  }

  const facility = {
    property_id: reports[0].property_master_id,
    ccn: reports[0].ccn,
    facility_name: reports[0].facility_name,
    state: reports[0].state
  };

  const formattedReports = reports.map(r => ({
    fiscal_year: r.fiscal_year,
    fiscal_year_end: r.fiscal_year_end,
    revenue: {
      total_patient: r.total_patient_revenue,
      medicare: r.medicare_revenue,
      medicaid: r.medicaid_revenue,
      private: r.private_revenue,
      other: r.other_revenue,
      net_patient: r.net_patient_revenue
    },
    expenses: {
      total_operating: r.total_operating_expenses,
      salary_wages: r.salary_wages,
      employee_benefits: r.employee_benefits,
      contract_services: r.contract_services,
      supplies: r.supplies,
      utilities: r.utilities,
      depreciation: r.depreciation,
      interest: r.interest_expense
    },
    profitability: {
      net_income: r.net_income,
      operating_margin: r.operating_margin,
      bad_debt: r.bad_debt,
      charity_care: r.charity_care
    },
    utilization: {
      total_beds: r.total_beds,
      total_patient_days: r.total_patient_days,
      occupancy_rate: r.occupancy_rate,
      cost_per_patient_day: r.cost_per_patient_day,
      nursing_cost_per_day: r.nursing_cost_per_day
    },
    payer_mix: {
      medicare_days: r.medicare_days,
      medicaid_days: r.medicaid_days,
      private_days: r.private_days,
      medicare_pct: r.medicare_pct,
      medicaid_pct: r.medicaid_pct,
      private_pct: r.private_pct
    }
  }));

  return success({
    facility,
    current_report: formattedReports[0],
    history: include_history ? formattedReports : undefined,
    years_returned: formattedReports.length
  });
}

export const definition = {
  name: 'get_cost_reports',
  description: 'Get CMS HCRIS cost report data for a SNF property including revenue, expenses, profitability, utilization, and payer mix. Supports historical fiscal year data.',
  inputSchema: {
    type: 'object',
    properties: {
      property_id: { type: 'number', description: 'Property ID' },
      ccn: { type: 'string', description: 'CMS Certification Number (6-digit)' },
      include_history: { type: 'boolean', description: 'Include historical fiscal years (default: current only)' },
      limit: { type: 'number', description: 'Max historical years to return (default 5)' }
    }
  }
};
