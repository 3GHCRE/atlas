/**
 * Tool: find_ownership_path
 * Find shortest path between two nodes in the ownership network using BFS
 */
import { z } from 'zod';
import { query, queryOne } from '../../database/connection.js';
import { success, notFound, clientError } from '../../utils/errors.js';
import type { ToolResult } from '../../utils/errors.js';
import { RowDataPacket } from 'mysql2/promise';

export const schema = z.object({
  source_type: z.enum(['property', 'entity', 'company', 'principal']).describe('Type of source node'),
  source_id: z.number().describe('ID of source node'),
  target_type: z.enum(['property', 'entity', 'company', 'principal']).describe('Type of target node'),
  target_id: z.number().describe('ID of target node'),
  max_depth: z.number().min(1).max(10).default(6).describe('Maximum path length (default 6)')
});

export type FindOwnershipPathParams = z.infer<typeof schema>;

interface NodeInfo {
  id: string;
  type: string;
  name: string;
  rawId: number;
}

interface PathEdge {
  from: string;
  to: string;
  relationship: string;
}

async function getNodeName(type: string, id: number): Promise<string> {
  interface NameRow extends RowDataPacket {
    name: string;
  }

  let result: NameRow[] = [];
  switch (type) {
    case 'property':
      result = await query<NameRow[]>(`SELECT facility_name as name FROM property_master WHERE id = ?`, [id]);
      break;
    case 'entity':
      result = await query<NameRow[]>(`SELECT entity_name as name FROM entities WHERE id = ?`, [id]);
      break;
    case 'company':
      result = await query<NameRow[]>(`SELECT company_name as name FROM companies WHERE id = ?`, [id]);
      break;
    case 'principal':
      result = await query<NameRow[]>(`SELECT full_name as name FROM principals WHERE id = ?`, [id]);
      break;
  }
  return result[0]?.name || `${type}_${id}`;
}

interface AdjRow extends RowDataPacket {
  neighbor_type: string;
  neighbor_id: number;
  relationship: string;
}

async function getNeighbors(nodeType: string, nodeId: number): Promise<Array<{ type: string; id: number; relationship: string }>> {
  const neighbors: Array<{ type: string; id: number; relationship: string }> = [];

  if (nodeType === 'property') {
    // Property -> Entity
    const entities = await query<AdjRow[]>(`
      SELECT 'entity' as neighbor_type, per.entity_id as neighbor_id, per.relationship_type as relationship
      FROM property_entity_relationships per
      WHERE per.property_master_id = ? AND per.end_date IS NULL
    `, [nodeId]);
    neighbors.push(...entities.map(e => ({ type: e.neighbor_type, id: e.neighbor_id, relationship: e.relationship })));
  }

  if (nodeType === 'entity') {
    // Entity -> Property
    const properties = await query<AdjRow[]>(`
      SELECT 'property' as neighbor_type, per.property_master_id as neighbor_id, per.relationship_type as relationship
      FROM property_entity_relationships per
      WHERE per.entity_id = ? AND per.end_date IS NULL
    `, [nodeId]);
    neighbors.push(...properties.map(p => ({ type: p.neighbor_type, id: p.neighbor_id, relationship: p.relationship })));

    // Entity -> Company
    const companies = await query<AdjRow[]>(`
      SELECT 'company' as neighbor_type, e.company_id as neighbor_id, 'parent_company' as relationship
      FROM entities e
      JOIN companies c ON c.id = e.company_id
      WHERE e.id = ? AND c.company_name NOT LIKE '[MERGED]%'
    `, [nodeId]);
    neighbors.push(...companies.map(c => ({ type: c.neighbor_type, id: c.neighbor_id, relationship: c.relationship })));

    // Entity -> Principal
    const principals = await query<AdjRow[]>(`
      SELECT 'principal' as neighbor_type, pner.principal_id as neighbor_id, pner.role as relationship
      FROM principal_entity_relationships pner
      WHERE pner.entity_id = ? AND pner.end_date IS NULL
    `, [nodeId]);
    neighbors.push(...principals.map(p => ({ type: p.neighbor_type, id: p.neighbor_id, relationship: p.relationship })));
  }

  if (nodeType === 'company') {
    // Company -> Entity
    const entities = await query<AdjRow[]>(`
      SELECT 'entity' as neighbor_type, e.id as neighbor_id, 'has_entity' as relationship
      FROM entities e
      WHERE e.company_id = ?
    `, [nodeId]);
    neighbors.push(...entities.map(e => ({ type: e.neighbor_type, id: e.neighbor_id, relationship: e.relationship })));

    // Company -> Principal
    const principals = await query<AdjRow[]>(`
      SELECT 'principal' as neighbor_type, pcr.principal_id as neighbor_id, pcr.role as relationship
      FROM principal_company_relationships pcr
      WHERE pcr.company_id = ? AND pcr.end_date IS NULL
    `, [nodeId]);
    neighbors.push(...principals.map(p => ({ type: p.neighbor_type, id: p.neighbor_id, relationship: p.relationship })));
  }

  if (nodeType === 'principal') {
    // Principal -> Company
    const companies = await query<AdjRow[]>(`
      SELECT 'company' as neighbor_type, pcr.company_id as neighbor_id, pcr.role as relationship
      FROM principal_company_relationships pcr
      JOIN companies c ON c.id = pcr.company_id
      WHERE pcr.principal_id = ? AND pcr.end_date IS NULL
        AND c.company_name NOT LIKE '[MERGED]%'
    `, [nodeId]);
    neighbors.push(...companies.map(c => ({ type: c.neighbor_type, id: c.neighbor_id, relationship: c.relationship })));

    // Principal -> Entity
    const entities = await query<AdjRow[]>(`
      SELECT 'entity' as neighbor_type, pner.entity_id as neighbor_id, pner.role as relationship
      FROM principal_entity_relationships pner
      WHERE pner.principal_id = ? AND pner.end_date IS NULL
    `, [nodeId]);
    neighbors.push(...entities.map(e => ({ type: e.neighbor_type, id: e.neighbor_id, relationship: e.relationship })));
  }

  return neighbors;
}

export async function execute(params: FindOwnershipPathParams): Promise<ToolResult> {
  const { source_type, source_id, target_type, target_id, max_depth = 6 } = params;

  if (!source_id || !target_id) {
    return clientError('Both source_id and target_id are required');
  }

  const sourceKey = `${source_type}_${source_id}`;
  const targetKey = `${target_type}_${target_id}`;

  // Verify nodes exist
  const sourceName = await getNodeName(source_type, source_id);
  const targetName = await getNodeName(target_type, target_id);

  if (sourceName === `${source_type}_${source_id}`) {
    return notFound(source_type, source_id);
  }
  if (targetName === `${target_type}_${target_id}`) {
    return notFound(target_type, target_id);
  }

  // BFS to find shortest path
  const visited = new Set<string>([sourceKey]);
  const parent = new Map<string, { node: string; relationship: string }>();
  const nodeInfo = new Map<string, NodeInfo>();

  nodeInfo.set(sourceKey, { id: sourceKey, type: source_type, name: sourceName, rawId: source_id });

  const queue: Array<{ key: string; type: string; id: number; depth: number }> = [
    { key: sourceKey, type: source_type, id: source_id, depth: 0 }
  ];

  let found = false;

  while (queue.length > 0 && !found) {
    const current = queue.shift()!;

    if (current.depth >= max_depth) continue;

    const neighbors = await getNeighbors(current.type, current.id);

    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.type}_${neighbor.id}`;

      if (visited.has(neighborKey)) continue;
      visited.add(neighborKey);

      const neighborName = await getNodeName(neighbor.type, neighbor.id);
      nodeInfo.set(neighborKey, { id: neighborKey, type: neighbor.type, name: neighborName, rawId: neighbor.id });
      parent.set(neighborKey, { node: current.key, relationship: neighbor.relationship });

      if (neighborKey === targetKey) {
        found = true;
        break;
      }

      queue.push({ key: neighborKey, type: neighbor.type, id: neighbor.id, depth: current.depth + 1 });
    }
  }

  if (!found) {
    return success({
      path_found: false,
      source: { type: source_type, id: source_id, name: sourceName },
      target: { type: target_type, id: target_id, name: targetName },
      message: `No path found within ${max_depth} hops`,
      nodes_explored: visited.size
    });
  }

  // Reconstruct path
  const path: NodeInfo[] = [];
  const edges: PathEdge[] = [];
  let currentKey = targetKey;

  while (currentKey !== sourceKey) {
    const info = nodeInfo.get(currentKey)!;
    path.unshift(info);
    const parentInfo = parent.get(currentKey)!;
    edges.unshift({
      from: parentInfo.node,
      to: currentKey,
      relationship: parentInfo.relationship
    });
    currentKey = parentInfo.node;
  }
  path.unshift(nodeInfo.get(sourceKey)!);

  return success({
    path_found: true,
    path_length: path.length - 1,
    source: { type: source_type, id: source_id, name: sourceName },
    target: { type: target_type, id: target_id, name: targetName },
    path: path.map((node, idx) => ({
      step: idx,
      type: node.type,
      id: node.rawId,
      name: node.name
    })),
    edges: edges.map((edge, idx) => ({
      step: idx + 1,
      from: edge.from,
      to: edge.to,
      relationship: edge.relationship
    })),
    nodes_explored: visited.size
  });
}

export const definition = {
  name: 'find_ownership_path',
  description: 'Find the shortest path between two nodes in the ownership network. Uses BFS to discover connections between any property, entity, company, or principal.',
  inputSchema: {
    type: 'object',
    properties: {
      source_type: { type: 'string', enum: ['property', 'entity', 'company', 'principal'], description: 'Type of source node' },
      source_id: { type: 'number', description: 'ID of source node' },
      target_type: { type: 'string', enum: ['property', 'entity', 'company', 'principal'], description: 'Type of target node' },
      target_id: { type: 'number', description: 'ID of target node' },
      max_depth: { type: 'number', description: 'Maximum path length (default 6)' }
    },
    required: ['source_type', 'source_id', 'target_type', 'target_id']
  }
};
