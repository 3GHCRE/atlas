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
import * as traceOperator from './graph/trace-operator.js';
import * as traceLender from './graph/trace-lender.js';
import * as getPortfolio from './graph/get-portfolio.js';
import * as findRelatedEntities from './graph/find-related-entities.js';
import * as getDealHistory from './graph/get-deal-history.js';
import * as getDealParties from './graph/get-deal-parties.js';
import * as tracePrincipalNetwork from './graph/trace-principal-network.js';

// Advanced network tools (Phase 4)
import * as traverseOwnershipNetwork from './graph/traverse-ownership-network.js';
import * as findOwnershipPath from './graph/find-ownership-path.js';
import * as getNetworkCentrality from './graph/get-network-centrality.js';
import * as getRelationshipStrength from './graph/get-relationship-strength.js';

// Market intelligence tools (Phase 4)
import * as getMarketStats from './market/get-market-stats.js';
import * as getTopBuyers from './market/get-top-buyers.js';
import * as getTopSellers from './market/get-top-sellers.js';
import * as getTopLenders from './market/get-top-lenders.js';
import * as getHotMarkets from './market/get-hot-markets.js';

// Hierarchy tools (Phase 5)
import * as identifyParentCompany from './hierarchy/identify-parent-company.js';
import * as getPropcoPortfolio from './hierarchy/get-propco-portfolio.js';
import * as getParentCompanyPortfolio from './hierarchy/get-parent-company-portfolio.js';
import * as getPortfolioHierarchy from './hierarchy/get-portfolio-hierarchy.js';

// Performance tools (Phase 6) - CMS Quality, Staffing, Cost Reports, Medicaid Rates
import * as getQualityRatings from './performance/get-quality-ratings.js';
import * as getStaffingData from './performance/get-staffing-data.js';
import * as getCostReports from './performance/get-cost-reports.js';
import * as getMedicaidRates from './performance/get-medicaid-rates.js';
import * as getFacilityPerformance from './performance/get-facility-performance.js';

// Intelligence tools (Phase 7) - SEC EDGAR and ProPublica for REITs/Nonprofits
import * as secCompanyLookup from './intelligence/sec-company-lookup.js';
import * as secGetFilings from './intelligence/sec-get-filings.js';
import * as secGetFilingContent from './intelligence/sec-get-filing-content.js';
import * as nonprofitSearch from './intelligence/nonprofit-search.js';
import * as nonprofitGet990 from './intelligence/nonprofit-get-990.js';
import * as verifyReitPortfolio from './intelligence/verify-reit-portfolio.js';

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
  trace_operator: traceOperator,
  trace_lender: traceLender,
  get_portfolio: getPortfolio,
  find_related_entities: findRelatedEntities,
  get_deal_history: getDealHistory,
  get_deal_parties: getDealParties,
  trace_principal_network: tracePrincipalNetwork,

  // Advanced network tools
  traverse_ownership_network: traverseOwnershipNetwork,
  find_ownership_path: findOwnershipPath,
  get_network_centrality: getNetworkCentrality,
  get_relationship_strength: getRelationshipStrength,

  // Market intelligence tools
  get_market_stats: getMarketStats,
  get_top_buyers: getTopBuyers,
  get_top_sellers: getTopSellers,
  get_top_lenders: getTopLenders,
  get_hot_markets: getHotMarkets,

  // Hierarchy tools
  identify_parent_company: identifyParentCompany,
  get_propco_portfolio: getPropcoPortfolio,
  get_parent_company_portfolio: getParentCompanyPortfolio,
  get_portfolio_hierarchy: getPortfolioHierarchy,

  // Performance tools
  get_quality_ratings: getQualityRatings,
  get_staffing_data: getStaffingData,
  get_cost_reports: getCostReports,
  get_medicaid_rates: getMedicaidRates,
  get_facility_performance: getFacilityPerformance,

  // Intelligence tools (SEC EDGAR + ProPublica)
  sec_company_lookup: secCompanyLookup,
  sec_get_filings: secGetFilings,
  sec_get_filing_content: secGetFilingContent,
  nonprofit_search: nonprofitSearch,
  nonprofit_get_990: nonprofitGet990,
  verify_reit_portfolio: verifyReitPortfolio,
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
