/**
 * Tool: get_principal
 * Get principal (individual) by ID with company and entity relationships
 * Handles merged/deduplicated principals - automatically resolves to canonical record
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, missingParam } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  id: z.number().describe('Principal ID'),
  include_merged: z.boolean().optional().default(true).describe('Include relationships from merged records (default true)')
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

interface MergeRow extends RowDataPacket {
  canonical_id: number;
  merged_id: number;
  merge_reason: string;
  confidence_score: number;
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
  const { id, include_merged = true } = params;

  if (!id) {
    return missingParam('id');
  }

  // Check if principal_merges table exists
  let mergesTableExists = true;
  try {
    await query<RowDataPacket[]>(`SELECT 1 FROM principal_merges LIMIT 1`);
  } catch {
    mergesTableExists = false;
  }

  let canonicalId = id;
  let wasRedirected = false;
  let mergedRecords: MergeRow[] = [];

  if (mergesTableExists) {
    // Check if this ID has been merged into a canonical record
    const mergeCheck = await queryOne<MergeRow>(`
      SELECT canonical_id, merged_id, merge_reason, confidence_score
      FROM principal_merges
      WHERE merged_id = ?
    `, [id]);

    // Use canonical ID if this was a merged record
    canonicalId = mergeCheck ? mergeCheck.canonical_id : id;
    wasRedirected = mergeCheck !== null;

    // Get all merged IDs for this canonical principal
    mergedRecords = await query<MergeRow[]>(`
      SELECT canonical_id, merged_id, merge_reason, confidence_score
      FROM principal_merges
      WHERE canonical_id = ?
    `, [canonicalId]);
  }

  // Get principal
  const principal = await queryOne<PrincipalRow>(`
    SELECT id, first_name, last_name, full_name, title, email,
           cms_associate_id_owner as cms_associate_id, address, city, state, zip
    FROM principals WHERE id = ?
  `, [canonicalId]);

  if (!principal) {
    return notFound('Principal', id);
  }

  // Build list of all principal IDs to query (canonical + merged)
  const allPrincipalIds = [canonicalId];
  if (include_merged && mergesTableExists) {
    for (const m of mergedRecords) {
      allPrincipalIds.push(m.merged_id);
    }
  }

  // Get company relationships (portfolio-level control)
  // Query across all merged IDs if include_merged is true
  const placeholders = allPrincipalIds.map(() => '?').join(',');
  const companyRels = await query<CompanyRelRow[]>(`
    SELECT DISTINCT c.id as company_id, c.company_name, c.company_type,
           pcr.role, pcr.ownership_percentage
    FROM principal_company_relationships pcr
    JOIN companies c ON c.id = pcr.company_id
    WHERE pcr.principal_id IN (${placeholders})
      AND pcr.end_date IS NULL
      AND c.company_name NOT LIKE '[MERGED]%'
    ORDER BY pcr.ownership_percentage DESC, c.company_name
  `, allPrincipalIds);

  // Get entity relationships (entity-level control)
  const entityRels = await query<EntityRelRow[]>(`
    SELECT DISTINCT e.id as entity_id, e.entity_name, e.entity_type,
           per.role, per.ownership_percentage
    FROM principal_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    WHERE per.principal_id IN (${placeholders})
      AND per.end_date IS NULL
    ORDER BY per.ownership_percentage DESC, e.entity_name
    LIMIT 50
  `, allPrincipalIds);

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
    merge_info: {
      is_canonical: !wasRedirected,
      canonical_id: canonicalId,
      requested_id: id,
      was_redirected: wasRedirected,
      merged_records: mergedRecords.map(m => ({
        merged_id: m.merged_id,
        merge_reason: m.merge_reason,
        confidence_score: m.confidence_score
      }))
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
      company_count: new Set(companyRels.map(r => r.company_id)).size,
      entity_count: new Set(entityRels.map(r => r.entity_id)).size,
      merged_record_count: mergedRecords.length
    }
  });
}

export const definition = {
  name: 'get_principal',
  description: 'Get individual principal (owner, officer, director) by ID, including company and entity relationships. Automatically resolves merged/duplicate records to their canonical ID and aggregates relationships.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Principal ID' },
      include_merged: { type: 'boolean', description: 'Include relationships from merged records (default true)' }
    },
    required: ['id']
  }
};
