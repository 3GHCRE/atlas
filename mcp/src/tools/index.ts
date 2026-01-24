/**
 * Tool registry - exports all MCP tools
 */

// Record tools (Phase 2)
import * as getProperty from './record/get-property.js';
import * as getEntity from './record/get-entity.js';
import * as getCompany from './record/get-company.js';
import * as getPrincipal from './record/get-principal.js';
import * as getDeal from './record/get-deal.js';
import * as searchProperties from './record/search-properties.js';
import * as searchCompanies from './record/search-companies.js';
import * as searchPrincipals from './record/search-principals.js';
import * as searchDeals from './record/search-deals.js';

// Graph tools (Phase 3)
import * as traceOwner from './graph/trace-owner.js';
import * as getPortfolio from './graph/get-portfolio.js';
import * as findRelatedEntities from './graph/find-related-entities.js';
import * as getDealHistory from './graph/get-deal-history.js';
import * as getDealParties from './graph/get-deal-parties.js';
import * as tracePrincipalNetwork from './graph/trace-principal-network.js';

// Tool type definition - using any for execute params since MCP passes generic objects
export interface Tool {
  definition: {
    name: string;
    description: string;
    inputSchema: object;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (params: any) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
}

// All tools registry
export const tools: Record<string, Tool> = {
  // Record tools
  get_property: getProperty,
  get_entity: getEntity,
  get_company: getCompany,
  get_principal: getPrincipal,
  get_deal: getDeal,
  search_properties: searchProperties,
  search_companies: searchCompanies,
  search_principals: searchPrincipals,
  search_deals: searchDeals,

  // Graph tools
  trace_owner: traceOwner,
  get_portfolio: getPortfolio,
  find_related_entities: findRelatedEntities,
  get_deal_history: getDealHistory,
  get_deal_parties: getDealParties,
  trace_principal_network: tracePrincipalNetwork,
};

// Export tool definitions for MCP registration
export function getToolDefinitions() {
  return Object.values(tools).map(tool => tool.definition);
}

// Export tool executor
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const tool = tools[name];
  if (!tool) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'unknown_tool', message: `Tool '${name}' not found` }) }],
      isError: true,
    };
  }

  try {
    return await tool.execute(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'execution_error', message }) }],
      isError: true,
    };
  }
}
