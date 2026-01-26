/**
 * Tool: traverse_ownership_network
 * Multi-hop traversal of ownership network with D3-compatible output
 */
import { z } from 'zod';
import { query } from '../../database/connection.js';
import { success, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  start_type: z.enum(['property', 'entity', 'company', 'principal']).describe('Type of starting node'),
  start_id: z.number().describe('ID of the starting node'),
  max_depth: z.number().min(1).max(5).default(3).describe('Maximum traversal depth (default 3, max 5)'),
  direction: z.enum(['up', 'down', 'both']).default('both').describe('Traversal direction (up=toward owners, down=toward properties)')
});

export type TraverseNetworkParams = z.infer<typeof schema>;

interface NodeRow extends RowDataPacket {
  node_id: string;
  node_type: string;
  node_name: string;
  node_subtype: string | null;
}

interface EdgeRow extends RowDataPacket {
  source_id: string;
  target_id: string;
  relationship_type: string;
  confidence_score: number | null;
}

interface GraphNode {
  id: string;
  type: string;
  name: string;
  subtype?: string;
  depth: number;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  confidence?: number;
}

export async function execute(params: TraverseNetworkParams): Promise<ToolResult> {
  const { start_type, start_id, max_depth = 3, direction = 'both' } = params;

  if (!start_id) {
    return clientError('start_id is required');
  }

  const nodes: Map<string, GraphNode> = new Map();
  const edges: GraphEdge[] = [];
  const visited = new Set<string>();

  // Add starting node
  const startNodeId = `${start_type}_${start_id}`;

  // Get starting node details
  let startName = '';
  switch (start_type) {
    case 'property':
      const prop = await query<NodeRow[]>(`SELECT facility_name as node_name FROM property_master WHERE id = ?`, [start_id]);
      startName = prop[0]?.node_name || `Property ${start_id}`;
      break;
    case 'entity':
      const ent = await query<NodeRow[]>(`SELECT entity_name as node_name, entity_type as node_subtype FROM entities WHERE id = ?`, [start_id]);
      startName = ent[0]?.node_name || `Entity ${start_id}`;
      break;
    case 'company':
      const comp = await query<NodeRow[]>(`SELECT company_name as node_name, company_type as node_subtype FROM companies WHERE id = ?`, [start_id]);
      startName = comp[0]?.node_name || `Company ${start_id}`;
      break;
    case 'principal':
      const prin = await query<NodeRow[]>(`SELECT full_name as node_name FROM principals WHERE id = ?`, [start_id]);
      startName = prin[0]?.node_name || `Principal ${start_id}`;
      break;
  }

  nodes.set(startNodeId, {
    id: startNodeId,
    type: start_type,
    name: startName,
    depth: 0
  });

  // BFS traversal
  const queue: Array<{ nodeId: string; type: string; id: number; depth: number }> = [
    { nodeId: startNodeId, type: start_type, id: start_id, depth: 0 }
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= max_depth || visited.has(current.nodeId)) continue;
    visited.add(current.nodeId);

    // Traverse based on current node type and direction
    if (current.type === 'property') {
      if (direction === 'up' || direction === 'both') {
        // Property -> Entity (owner/operator)
        const rels = await query<EdgeRow[]>(`
          SELECT
            CONCAT('property_', per.property_master_id) as source_id,
            CONCAT('entity_', per.entity_id) as target_id,
            per.relationship_type,
            NULL as confidence_score
          FROM property_entity_relationships per
          WHERE per.property_master_id = ? AND per.end_date IS NULL
        `, [current.id]);

        for (const rel of rels) {
          const entityId = parseInt(rel.target_id.split('_')[1]);
          const entityDetails = await query<NodeRow[]>(`
            SELECT e.entity_name as node_name, e.entity_type as node_subtype
            FROM entities e WHERE e.id = ?
          `, [entityId]);

          if (entityDetails.length > 0 && !nodes.has(rel.target_id)) {
            nodes.set(rel.target_id, {
              id: rel.target_id,
              type: 'entity',
              name: entityDetails[0].node_name,
              subtype: entityDetails[0].node_subtype || undefined,
              depth: current.depth + 1
            });
            queue.push({ nodeId: rel.target_id, type: 'entity', id: entityId, depth: current.depth + 1 });
          }
          edges.push({
            source: rel.source_id,
            target: rel.target_id,
            relationship: rel.relationship_type,
            confidence: rel.confidence_score || undefined
          });
        }
      }
    }

    if (current.type === 'entity') {
      // Entity -> Company (parent)
      if (direction === 'up' || direction === 'both') {
        const companyRel = await query<EdgeRow[]>(`
          SELECT
            CONCAT('entity_', e.id) as source_id,
            CONCAT('company_', e.company_id) as target_id,
            'parent_company' as relationship_type,
            1.0 as confidence_score
          FROM entities e
          JOIN companies c ON c.id = e.company_id
          WHERE e.id = ? AND c.company_name NOT LIKE '[MERGED]%'
        `, [current.id]);

        for (const rel of companyRel) {
          const companyId = parseInt(rel.target_id.split('_')[1]);
          const companyDetails = await query<NodeRow[]>(`
            SELECT company_name as node_name, company_type as node_subtype
            FROM companies WHERE id = ?
          `, [companyId]);

          if (companyDetails.length > 0 && !nodes.has(rel.target_id)) {
            nodes.set(rel.target_id, {
              id: rel.target_id,
              type: 'company',
              name: companyDetails[0].node_name,
              subtype: companyDetails[0].node_subtype || undefined,
              depth: current.depth + 1
            });
            queue.push({ nodeId: rel.target_id, type: 'company', id: companyId, depth: current.depth + 1 });
          }
          edges.push({
            source: rel.source_id,
            target: rel.target_id,
            relationship: rel.relationship_type,
            confidence: rel.confidence_score || undefined
          });
        }
      }

      // Entity -> Properties (down)
      if (direction === 'down' || direction === 'both') {
        const propRels = await query<EdgeRow[]>(`
          SELECT
            CONCAT('entity_', per.entity_id) as source_id,
            CONCAT('property_', per.property_master_id) as target_id,
            per.relationship_type,
            NULL as confidence_score
          FROM property_entity_relationships per
          WHERE per.entity_id = ? AND per.end_date IS NULL
        `, [current.id]);

        for (const rel of propRels) {
          const propId = parseInt(rel.target_id.split('_')[1]);
          const propDetails = await query<NodeRow[]>(`
            SELECT facility_name as node_name FROM property_master WHERE id = ?
          `, [propId]);

          if (propDetails.length > 0 && !nodes.has(rel.target_id)) {
            nodes.set(rel.target_id, {
              id: rel.target_id,
              type: 'property',
              name: propDetails[0].node_name,
              depth: current.depth + 1
            });
            queue.push({ nodeId: rel.target_id, type: 'property', id: propId, depth: current.depth + 1 });
          }
          edges.push({
            source: rel.source_id,
            target: rel.target_id,
            relationship: rel.relationship_type,
            confidence: rel.confidence_score || undefined
          });
        }
      }
    }

    if (current.type === 'company') {
      // Company -> Principals (up)
      if (direction === 'up' || direction === 'both') {
        const principalRels = await query<EdgeRow[]>(`
          SELECT
            CONCAT('company_', pcr.company_id) as source_id,
            CONCAT('principal_', pcr.principal_id) as target_id,
            pcr.role as relationship_type,
            NULL as confidence_score
          FROM principal_company_relationships pcr
          WHERE pcr.company_id = ? AND pcr.end_date IS NULL
        `, [current.id]);

        for (const rel of principalRels) {
          const principalId = parseInt(rel.target_id.split('_')[1]);
          const principalDetails = await query<NodeRow[]>(`
            SELECT full_name as node_name FROM principals WHERE id = ?
          `, [principalId]);

          if (principalDetails.length > 0 && !nodes.has(rel.target_id)) {
            nodes.set(rel.target_id, {
              id: rel.target_id,
              type: 'principal',
              name: principalDetails[0].node_name,
              depth: current.depth + 1
            });
            queue.push({ nodeId: rel.target_id, type: 'principal', id: principalId, depth: current.depth + 1 });
          }
          edges.push({
            source: rel.source_id,
            target: rel.target_id,
            relationship: rel.relationship_type,
            confidence: rel.confidence_score || undefined
          });
        }
      }

      // Company -> Entities (down)
      if (direction === 'down' || direction === 'both') {
        const entityRels = await query<EdgeRow[]>(`
          SELECT
            CONCAT('company_', e.company_id) as source_id,
            CONCAT('entity_', e.id) as target_id,
            'has_entity' as relationship_type,
            1.0 as confidence_score
          FROM entities e
          WHERE e.company_id = ?
        `, [current.id]);

        for (const rel of entityRels) {
          const entityId = parseInt(rel.target_id.split('_')[1]);
          const entityDetails = await query<NodeRow[]>(`
            SELECT entity_name as node_name, entity_type as node_subtype
            FROM entities WHERE id = ?
          `, [entityId]);

          if (entityDetails.length > 0 && !nodes.has(rel.target_id)) {
            nodes.set(rel.target_id, {
              id: rel.target_id,
              type: 'entity',
              name: entityDetails[0].node_name,
              subtype: entityDetails[0].node_subtype || undefined,
              depth: current.depth + 1
            });
            queue.push({ nodeId: rel.target_id, type: 'entity', id: entityId, depth: current.depth + 1 });
          }
          edges.push({
            source: rel.source_id,
            target: rel.target_id,
            relationship: rel.relationship_type,
            confidence: rel.confidence_score || undefined
          });
        }
      }
    }

    if (current.type === 'principal') {
      // Principal -> Companies (down)
      if (direction === 'down' || direction === 'both') {
        const companyRels = await query<EdgeRow[]>(`
          SELECT
            CONCAT('principal_', pcr.principal_id) as source_id,
            CONCAT('company_', pcr.company_id) as target_id,
            pcr.role as relationship_type,
            NULL as confidence_score
          FROM principal_company_relationships pcr
          JOIN companies c ON c.id = pcr.company_id
          WHERE pcr.principal_id = ? AND pcr.end_date IS NULL
            AND c.company_name NOT LIKE '[MERGED]%'
        `, [current.id]);

        for (const rel of companyRels) {
          const companyId = parseInt(rel.target_id.split('_')[1]);
          const companyDetails = await query<NodeRow[]>(`
            SELECT company_name as node_name, company_type as node_subtype
            FROM companies WHERE id = ?
          `, [companyId]);

          if (companyDetails.length > 0 && !nodes.has(rel.target_id)) {
            nodes.set(rel.target_id, {
              id: rel.target_id,
              type: 'company',
              name: companyDetails[0].node_name,
              subtype: companyDetails[0].node_subtype || undefined,
              depth: current.depth + 1
            });
            queue.push({ nodeId: rel.target_id, type: 'company', id: companyId, depth: current.depth + 1 });
          }
          edges.push({
            source: rel.source_id,
            target: rel.target_id,
            relationship: rel.relationship_type,
            confidence: rel.confidence_score || undefined
          });
        }
      }
    }
  }

  // Convert to D3-compatible format
  const nodeArray = Array.from(nodes.values());
  const uniqueEdges = edges.filter((edge, index, self) =>
    index === self.findIndex(e => e.source === edge.source && e.target === edge.target && e.relationship === edge.relationship)
  );

  return success({
    graph: {
      nodes: nodeArray,
      edges: uniqueEdges
    },
    statistics: {
      total_nodes: nodeArray.length,
      total_edges: uniqueEdges.length,
      max_depth_reached: Math.max(...nodeArray.map(n => n.depth)),
      nodes_by_type: {
        property: nodeArray.filter(n => n.type === 'property').length,
        entity: nodeArray.filter(n => n.type === 'entity').length,
        company: nodeArray.filter(n => n.type === 'company').length,
        principal: nodeArray.filter(n => n.type === 'principal').length
      }
    },
    parameters: {
      start_type,
      start_id,
      max_depth,
      direction
    }
  });
}

export const definition = {
  name: 'traverse_ownership_network',
  description: 'Traverse the ownership network from any node (property, entity, company, principal) with configurable depth and direction. Returns D3-compatible graph structure with nodes and edges.',
  inputSchema: {
    type: 'object',
    properties: {
      start_type: { type: 'string', enum: ['property', 'entity', 'company', 'principal'], description: 'Type of starting node' },
      start_id: { type: 'number', description: 'ID of the starting node' },
      max_depth: { type: 'number', description: 'Maximum traversal depth (default 3, max 5)' },
      direction: { type: 'string', enum: ['up', 'down', 'both'], description: 'Traversal direction (up=toward owners, down=toward properties)' }
    },
    required: ['start_type', 'start_id']
  }
};
