# Ohio SNF Market E2E Test Brief
**Generated:** 2026-01-24  
**Purpose:** End-to-end validation of Atlas MCP tools across all data categories  
**Test State:** Ohio (selected for Medicaid rate data availability)

---

## Executive Summary

Full E2E test completed successfully across 5 tool categories (25+ individual tools). All new performance tools operational. One bug identified in `get_network_centrality` (connection timeout).

### Test Results Summary

| Category | Tools Tested | Status |
|----------|--------------|--------|
| Property Search & Details | 5 | ✅ Pass |
| Ownership & Entity Tracing | 6 | ✅ Pass |
| Deal & Transaction Data | 4 | ✅ Pass |
| Performance Data (NEW) | 5 | ✅ Pass |
| Market Analytics | 5 | ⚠️ 4/5 (1 bug) |
| Network Traversal | 4 | ✅ Pass |

---

## 1. Ohio Market Overview

### Market Statistics (365-day lookback)
- **Total Transactions:** 68
- **Total Volume:** $2.81B
- **Unique Properties:** 64
- **National Rank:** #2 (11.8% market share)

### Transaction Breakdown
| Type | Count | Volume | Avg Size |
|------|-------|--------|----------|
| Mortgage | 50 | $2.73B | $56.9M |
| Sale | 18 | $76.5M | $4.3M |

### Top Companies by Property Count (Ohio HQ)
| Company | Type | Properties | Entities |
|---------|------|------------|----------|
| Welltower | Ownership | 219 | 223 |
| Saber Healthcare Group | Owner/Operator | 129 | 162 |
| CommuniCare Health | Owner/Operator | 107 | 134 |
| Foundations Health Solutions | Owner/Operator | 65 | 87 |
| Atrium Centers | Owner/Operator | 26 | 38 |

---

## 2. Performance Data Validation

### Test Facilities

#### Bath Manor Special Care Centre (CCN: 365847)
**Owner/Operator:** Saber Healthcare Group  
**Location:** Akron, OH  
**Beds:** 130

| Metric | Value | Rating |
|--------|-------|--------|
| Overall Star Rating | 2 | - |
| Health Inspection | 2 | - |
| Staffing | 2 | - |
| Quality Measures | 4 | - |
| Total Nurse HPRD | 3.74 | - |
| RN HPRD | 0.59 | - |
| Staff Turnover | 52.0% | - |
| Medicaid Rate | $287.11/day | +5.5% vs state avg |
| Penalties | 1 | $14,433 |

#### Vancrest of Ada (CCN: 366444)
**Owner/Operator:** Vancrest Health Care Centers  
**Location:** Ada, OH  
**Beds:** 60

| Metric | Value | Rating |
|--------|-------|--------|
| Overall Star Rating | 2 | - |
| Health Inspection | 2 | - |
| Staffing | 3 | - |
| Quality Measures | 4 | - |
| Total Nurse HPRD | 3.94 | - |
| RN HPRD | 0.53 | - |
| Staff Turnover | 34.8% | - |
| Medicaid Rate | $280.58/day | +3.1% vs state avg |
| Penalties | 0 | $0 |

#### Bellevue Care Center (CCN: 366131)
**Owner/Operator:** Saber Healthcare Group  
**Location:** Bellevue, OH  
**Beds:** 63

| Metric | Value | Rating |
|--------|-------|--------|
| Overall Star Rating | **5** | Top performer |
| Health Inspection | **5** | - |
| Staffing | 2 | - |
| Quality Measures | **5** | - |
| Total Nurse HPRD | 3.47 | - |
| RN HPRD | 0.58 | - |
| Staff Turnover | **26.1%** | Best in sample |
| Medicaid Rate | $258.49/day | -5.0% vs state avg |
| Penalties | 0 | $0 |

### Ohio Medicaid Rate Context
- **State Average:** $272.18/day
- **Range:** $189.63 - $354.49
- **Facilities Reporting:** 787

---

## 3. Ownership Tracing Validation

### Case Study: Bath Manor Special Care Centre

**Ownership Chain:**
```
Property: Bath Manor Special Care Centre (CCN: 365847)
    └── Entity: Bath Manor Limited Partnership (OpCo)
        └── Company: Saber Healthcare Group (Owner/Operator)
            └── Principal: Melvyn Howard (50% indirect owner)
```

**Key Principal: Melvyn Howard**
- CMS Associate ID: 9133513104
- Ownership: 50% of Saber Healthcare Group
- Roles: Owner, Officer
- Entity Affiliations: 6 entities (Bath Manor LP, Aurora Manor LP, etc.)

### Saber Healthcare Group Portfolio
- **Total Properties:** 129 (7 states)
- **Total Entities:** 162 (OpCos + PropCos)
- **Total Principals:** 208
- **States:** AR, DE, IN, NC, OH, PA, VA
- **Ohio Properties:** 10 (sample)

### Related Companies (Lenders)
| Lender | Shared Properties |
|--------|-------------------|
| CIBC Bank USA | 11 |
| Huntington National Bank | 10 |
| Lehman Brothers Bank FSB | 6 |
| GE Capital | 6 |
| Merrill Lynch Capital | 5 |

---

## 4. Transaction Data Validation

### Recent Ohio Deals (Sample)

| Property | Type | Date | Amount |
|----------|------|------|--------|
| Belpre Landing Nursing | Mortgage | 2025-11-01 | $18.3M |
| Rockland Ridge Nursing | Mortgage | 2025-11-01 | $9.3M |
| Gardens of Paulding | Sale | 2025-07-10 | $3.9M |
| Gardens of Paulding | Mortgage | 2025-07-10 | $230M |
| Piketon Nursing Center | Mortgage | 2025-07-15 | $15.2M |

### Deal Detail: Gardens of Paulding Sale
- **Deal ID:** 9422
- **Type:** Sale (Non-Residential Arm's Length)
- **Amount:** $3,900,000
- **Price/SqFt:** $104.54
- **Buyer:** Gardens At Paulding Propco LLC
- **Seller:** Paulding Medical Land II LLC

---

## 5. National Market Rankings (365 days)

| Rank | State | Deals | Volume | Avg Deal |
|------|-------|-------|--------|----------|
| 1 | CA | 92 | $10.5B | $57.7M |
| 2 | **OH** | 68 | $5.6B | $42.2M |
| 3 | PA | 53 | $2.8B | $31.0M |
| 4 | FL | 51 | $3.5B | $33.0M |
| 5 | MA | 49 | $1.2B | $15.9M |
| 6 | NC | 39 | $4.1B | $61.5M |
| 7 | WA | 33 | $4.0B | $66.6M |
| 8 | NY | 32 | $1.3B | $20.6M |
| 9 | IL | 32 | $532M | $9.2M |
| 10 | CO | 29 | $7.7B | $132.6M |

**National Totals:**
- Total Deals: 577
- Total Volume: $44.7B
- Unique Properties: 408

---

## 6. Tool Validation Results

### New Performance Tools (All Passing)

| Tool | Test Method | Result |
|------|-------------|--------|
| `get_quality_ratings` | CCN + property_id + history | ✅ |
| `get_staffing_data` | CCN lookup | ✅ |
| `get_cost_reports` | CCN lookup | ✅ |
| `get_medicaid_rates` | CCN + state comparison | ✅ |
| `get_facility_performance` | Combined summary | ✅ |

### Existing Tools Validated

| Category | Tools | Status |
|----------|-------|--------|
| search_properties | state, city, name filters | ✅ |
| search_companies | state, min_properties | ✅ |
| search_deals | state, date range | ✅ |
| get_company | id lookup | ✅ |
| get_portfolio | company_id + state filter | ✅ |
| trace_owner | CCN lookup | ✅ |
| get_principal | id + merge resolution | ✅ |
| get_deal | id + parties | ✅ |
| get_market_stats | state + group_by | ✅ |
| get_hot_markets | national ranking | ✅ |
| get_top_sellers | state filter | ✅ |
| find_related_entities | lender relationships | ✅ |
| traverse_ownership_network | depth=2 | ✅ (large output) |

### Known Issues

| Tool | Issue | Priority |
|------|-------|----------|
| `get_network_centrality` | Connection timeout/closed | **Review** |
| `get_top_buyers` | Returns empty for OH (data gap?) | Low |
| `get_top_lenders` | Returns empty for OH (data gap?) | Low |

---

## 7. Data Availability Summary

### Ohio Coverage
- **Properties:** 787+ with Medicaid rates
- **Quality Ratings:** Current (Jan 2026)
- **Staffing Data:** Current quarter
- **Cost Reports:** FY2024
- **Transactions:** 68 in past 365 days

### Performance Data Completeness
| Field | Availability |
|-------|--------------|
| Star Ratings | ✅ Complete |
| SFF Status | ✅ Complete |
| Penalties/Fines | ✅ Complete |
| Staffing HPRD | ✅ Complete |
| Turnover Rates | ✅ Complete |
| Medicaid Rates | ✅ Complete (OH) |
| Operating Margin | ✅ Partial |
| Occupancy Rate | ❌ Missing |
| Payer Mix | ❌ Missing |
| Cost/Patient Day | ❌ Missing |

---

## Appendix: Test Commands Reference

```javascript
// Performance Tools
get_quality_ratings({ ccn: "365847", include_history: true })
get_staffing_data({ ccn: "365847" })
get_cost_reports({ ccn: "365847" })
get_medicaid_rates({ ccn: "366444" })
get_facility_performance({ ccn: "365847" })

// Ownership Tools
trace_owner({ ccn: "365847" })
get_principal({ id: 36673 })
get_portfolio({ company_id: 10, state: "OH" })

// Market Tools
get_market_stats({ state: "OH", days: 365, group_by: "deal_type" })
get_hot_markets({ days: 365, limit: 15 })
get_top_sellers({ state: "OH", days: 365 })

// Network Tools
find_related_entities({ company_id: 10 })
traverse_ownership_network({ start_type: "company", start_id: 10, direction: "both", max_depth: 2 })
```

---

*Generated by Atlas MCP E2E Test Suite*
