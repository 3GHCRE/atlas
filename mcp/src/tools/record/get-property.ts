/**
 * Tool: get_property
 * Get property by ID or CCN with all relationships
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  id: z.number().optional().describe('Property ID'),
  ccn: z.string().optional().describe('CMS Certification Number (6-digit)')
}).refine(data => data.id || data.ccn, {
  message: 'Either id or ccn must be provided'
});

export type GetPropertyParams = z.infer<typeof schema>;

interface PropertyRow extends RowDataPacket {
  id: number;
  ccn: string;
  facility_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

interface RelationshipRow extends RowDataPacket {
  relationship_type: string;
  entity_id: number;
  entity_name: string;
  entity_type: string | null;
  company_id: number;
  company_name: string;
  company_type: string | null;
}

export async function execute(params: GetPropertyParams): Promise<ToolResult> {
  const { id, ccn } = params;

  if (!id && !ccn) {
    return clientError('Either id or ccn must be provided');
  }

  // Get property
  let property: PropertyRow | null;
  if (id) {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, facility_name, address, city, state, zip, latitude, longitude
       FROM property_master WHERE id = ?`,
      [id]
    );
  } else {
    property = await queryOne<PropertyRow>(
      `SELECT id, ccn, facility_name, address, city, state, zip, latitude, longitude
       FROM property_master WHERE ccn = ?`,
      [ccn]
    );
  }

  if (!property) {
    return notFound('Property', id || ccn || '');
  }

  // Get all relationships for this property (following showcase-navigation.js pattern)
  const relationships = await query<RelationshipRow[]>(`
    SELECT per.relationship_type, e.id as entity_id, e.entity_name, e.entity_type,
           c.id as company_id, c.company_name, c.company_type
    FROM property_entity_relationships per
    JOIN entities e ON e.id = per.entity_id
    JOIN companies c ON c.id = e.company_id
    WHERE per.property_master_id = ?
      AND c.company_name NOT LIKE '[MERGED]%'
    ORDER BY FIELD(per.relationship_type,
      'property_owner', 'facility_operator', 'lender',
      'property_buyer', 'property_seller', 'property_borrower')
  `, [property.id]);

  return success({
    property: {
      id: property.id,
      ccn: property.ccn,
      facility_name: property.facility_name,
      address: property.address,
      city: property.city,
      state: property.state,
      zip: property.zip,
      location: property.latitude && property.longitude
        ? { lat: property.latitude, lng: property.longitude }
        : null
    },
    relationships: relationships.map(r => ({
      relationship_type: r.relationship_type,
      entity: {
        id: r.entity_id,
        name: r.entity_name,
        type: r.entity_type
      },
      company: {
        id: r.company_id,
        name: r.company_name,
        type: r.company_type
      }
    }))
  });
}

export const definition = {
  name: 'get_property',
  description: 'Get SNF property details by ID or CCN (CMS Certification Number), including all ownership relationships (owner, operator, lender)',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Property ID' },
      ccn: { type: 'string', description: 'CMS Certification Number (6-digit)' }
    }
  }
};
