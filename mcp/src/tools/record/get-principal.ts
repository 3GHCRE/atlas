/**
 * Tool: get_principal
 * Get principal (individual) by ID with company and entity relationships
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  id: z.number().describe('Principal ID')
});

export type GetPrincipalParams = z.infer<typeof schema>;

interface PrincipalRow extends RowDataPacket {
  id: number;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  title: string | null;
  email: string | null;
  cms_associate_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface CompanyRelRow extends RowDataPacket {
  company_id: number;
  company_name: string;
  company_type: string | null;
  role: string;
  ownership_percentage: number | null;
}

interface EntityRelRow extends RowDataPacket {
  entity_id: number;
  entity_name: string;
  entity_type: string | null;
  role: string;
  ownership_percentage: number | null;
}

export async function execute(params: GetPrincipalParams): Promise<ToolResult> {
  const { id } = params;

  if (!id) {
    return missingParam('id');
  }

  // Get principal
  const principal = await queryOne<PrincipalRow>(`
    SELECT id, first_name, last_name, full_name, title, email,
           cms_associate_id, address, city, state, zip
    FROM principals WHERE id = ?
  `, [id]);

  if (!principal) {
    return notFound('Principal', id);
  }

  // Get company relationships (portfolio-level control)
  const companyRels = await query<CompanyRelRow[]>(`
    SELECT c.id as company_id, c.company_name, c.company_type,
           pcr.role, pcr.ownership_percentage
    FROM principal_company_relationships pcr
    JOIN companies c ON c.id = pcr.company_id
    WHERE pcr.principal_id = ?
      AND pcr.end_date IS NULL
      AND c.company_name NOT LIKE '[MERGED]%'
    ORDER BY pcr.ownership_percentage DESC, c.company_name
  `, [id]);

  // Get entity relationships (entity-level control)
  const entityRels = await query<EntityRelRow[]>(`
    SELECT e.id as entity_id, e.entity_name, e.entity_type,
           per.role, per.ownership_percentage
    FROM principal_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    WHERE per.principal_id = ?
      AND per.end_date IS NULL
    ORDER BY per.ownership_percentage DESC, e.entity_name
    LIMIT 50
  `, [id]);

  return success({
    principal: {
      id: principal.id,
      first_name: principal.first_name,
      last_name: principal.last_name,
      full_name: principal.full_name,
      title: principal.title,
      email: principal.email,
      cms_associate_id: principal.cms_associate_id,
      address: principal.address,
      city: principal.city,
      state: principal.state,
      zip: principal.zip
    },
    company_relationships: companyRels.map(r => ({
      company_id: r.company_id,
      company_name: r.company_name,
      company_type: r.company_type,
      role: r.role,
      ownership_percentage: r.ownership_percentage
    })),
    entity_relationships: entityRels.map(r => ({
      entity_id: r.entity_id,
      entity_name: r.entity_name,
      entity_type: r.entity_type,
      role: r.role,
      ownership_percentage: r.ownership_percentage
    })),
    statistics: {
      company_count: companyRels.length,
      entity_count: entityRels.length
    }
  });
}

export const definition = {
  name: 'get_principal',
  description: 'Get individual principal (owner, officer, director) by ID, including company and entity relationships',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Principal ID' }
    },
    required: ['id']
  }
};
