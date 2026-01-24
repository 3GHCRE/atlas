/**
 * TypeScript types for Atlas database entities
 */
import { RowDataPacket } from 'mysql2/promise';

// Base row type for all database entities
export interface Property extends RowDataPacket {
  id: number;
  ccn: string;
  reapi_property_id: string | null;
  zoho_account_id: string | null;
  facility_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string | null;
  lat: number | null;
  lng: number | null;
  bed_count: number | null;
  data_quality_score: number | null;
}

export interface Entity extends RowDataPacket {
  id: number;
  entity_name: string;
  entity_type: string | null;
  company_id: number;
  dba_name: string | null;
  ein: string | null;
  cms_associate_id: string | null;
  state_of_incorp: string | null;
  zoho_entity_id: string | null;
}

export interface Company extends RowDataPacket {
  id: number;
  company_name: string;
  company_type: string | null;
  dba_name: string | null;
  cms_affiliated_entity_id: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  zoho_company_id: string | null;
}

export interface Principal extends RowDataPacket {
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
  zoho_contact_id: string | null;
}

export interface Deal extends RowDataPacket {
  id: number;
  property_master_id: number;
  ccn: string;
  deal_type: string;
  effective_date: Date | null;
  recorded_date: Date | null;
  amount: number | null;
  document_id: string | null;
  data_source: string | null;
}

export interface DealParty extends RowDataPacket {
  id: number;
  deal_id: number;
  party_role: string;
  party_name: string;
  party_dba_name: string | null;
  company_id: number | null;
  principal_id: number | null;
  entity_id: number | null;
  enrollment_id: string | null;
  associate_id: string | null;
}

export interface PropertyRelationship extends RowDataPacket {
  id: number;
  property_master_id: number;
  entity_id: number;
  relationship_type: string;
  ownership_percentage: number | null;
  effective_date: Date | null;
  end_date: Date | null;
  data_source: string | null;
}

export interface PrincipalEntityRelationship extends RowDataPacket {
  id: number;
  principal_id: number;
  entity_id: number;
  role: string;
  ownership_percentage: number | null;
  effective_date: Date | null;
  end_date: Date | null;
  data_source: string | null;
}

export interface PrincipalCompanyRelationship extends RowDataPacket {
  id: number;
  principal_id: number;
  company_id: number;
  role: string;
  ownership_percentage: number | null;
  effective_date: Date | null;
  end_date: Date | null;
  data_source: string | null;
}

// Relationship types enum
export const RELATIONSHIP_TYPES = [
  'property_owner',
  'facility_operator',
  'lender',
  'property_buyer',
  'property_seller',
  'property_borrower',
  'management_services',
  'parent_company',
  'affiliate',
  'consultant',
  'other'
] as const;

export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

// Entity types enum
export const ENTITY_TYPES = [
  'opco',
  'propco',
  'management',
  'holding',
  'pe_firm',
  'reit',
  'other'
] as const;

export type EntityType = typeof ENTITY_TYPES[number];

// Deal types enum
export const DEAL_TYPES = [
  'chow',
  'sale',
  'mortgage',
  'assignment',
  'satisfaction',
  'lease',
  'refinance',
  'other'
] as const;

export type DealType = typeof DEAL_TYPES[number];
