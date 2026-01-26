# Eliezer (Lou) Scheiner Ownership Network

**Last Updated:** January 25, 2026
**Principal ID:** 8429

---

## Overview

Lou Scheiner is a major figure in skilled nursing through **PropCo ownership** via Texas hospital districts, not as an operator. He owns real estate through hospital district structures (UPL arrangements) while separate OpCos operate the facilities.

**Key Distinction:**
- **PropCo (Property Company):** Owns the real estate - Scheiner's companies
- **OpCo (Operating Company):** Operates the facilities - Ensign, Nexion, etc.

Scheiner is NOT a principal at Ensign, Nexion, Creative Solutions, etc. - these are separate operators that lease/manage buildings owned by his hospital district structures.

---

## Legitimate Company Relationships

### Direct Ownership
| Company | Role | Ownership | Properties |
|---------|------|-----------|------------|
| TL MANAGEMENT | Owner | - | 37 |
| OPOP, LLC | Owner | 65% | 1 |
| WMOP LLC | Owner | 45% | 1 |

### Hospital District Structures (UPL Arrangements)
| Company | Role | Ownership | Properties |
|---------|------|-----------|------------|
| HAMILTON COUNTY HOSPITAL DISTRICT | Manager | - | 70 |
| CORYELL COUNTY MEMORIAL HOSPITAL AUTHORITY | Manager/Director | 39.5% | 32 |

### Operating/Management Companies
| Company | Role | Ownership | Properties |
|---------|------|-----------|------------|
| AVIR HEALTH GROUP | Manager | 39.5% | 27 |
| CARING HEALTHCARE GROUP | Manager/Director | 39.5% | 30 |
| MOMENTUM SKILLED SERVICES | Manager/Director | 39.5% | 8 |
| FOURCOOKS SENIOR CARE | Manager/Director | 39.5% | 4 |

### Other Holdings
| Company | Role | Notes |
|---------|------|-------|
| HTLF BANK | Listed as Owner | Likely lender relationship |
| FOURSQUARE HEALTHCARE | Manager | 0 properties |
| GULF COAST LTC PARTNERS | Manager/Director | 0 properties |
| RUBY HEALTHCARE | Manager/Director | 0 properties |
| PARAMOUNT HEALTHCARE | Manager | 0 properties |

---

## Texas UPL Structure Explained

The **Upper Payment Limit (UPL)** is a Medicaid reimbursement mechanism that allows Texas hospital districts to receive enhanced federal matching funds for nursing home services.

**How it works:**
1. Hospital district (e.g., Hamilton County) takes ownership of nursing facilities
2. Private operator (e.g., Ensign, Nexion) leases and operates the facilities
3. Hospital district can draw down higher Medicaid reimbursements
4. Operators benefit from the arrangement through lease terms

**Scheiner's role:** Board member/manager at the hospital district level, overseeing the PropCo structure. He does NOT manage day-to-day operations.

---

## Corrected Network Statistics

**Before cleanup:**
- 32 companies (inflated - included Ensign, Nexion, Creative Solutions incorrectly)
- 904 properties (grossly inflated)

**After cleanup:**
- ~15 unique companies (his actual entities)
- ~200 properties (via hospital districts + direct ownership)
- 15+ states

---

## Properties by Operator Relationship

The properties in Scheiner's portfolio are operated by various third-party operators:

| Operator | Approx. Properties | Relationship |
|----------|-------------------|--------------|
| Ensign Group | ~50 | Leases from Hamilton County HD |
| Nexion Health | ~40 | Leases from Coryell County |
| Creative Solutions | ~30 | Leases from various districts |
| SLP Operations | ~20 | Leases/manages |
| Other operators | ~60 | Various arrangements |

These operators are **NOT** companies where Scheiner is a principal - they are separate operating companies that have business relationships with his PropCos.

---

## Data Quality Notes

**Issue Found (Jan 25, 2026):**
CMS data incorrectly linked Scheiner as "manager" at major operators (Ensign, Nexion, Creative Solutions, etc.). This was likely due to how CMS ownership forms capture "managing employee" at the facility level, which got incorrectly propagated to company-level relationships.

**Fix Applied:**
Removed 12 incorrect principal-company relationships:
- THE ENSIGN GROUP (rel_id: 13301)
- NEXION HEALTH (rel_id: 13305)
- CREATIVE SOLUTIONS IN HEALTHCARE (rel_ids: 13309, 13310)
- FUNDAMENTAL HEALTHCARE (rel_id: 13311)
- SLP OPERATIONS (rel_id: 13318)
- OPCO SKILLED MANAGEMENT (rel_ids: 13316, 13317)
- ADVANCED HEALTHCARE SOLUTIONS (rel_ids: 13338, 13339)
- TOUCHSTONE COMMUNITIES (rel_id: 13312)
- FOCUSED POST ACUTE CARE PARTNERS (rel_id: 13326)

---

## Related Research

- Texas Hospital District UPL arrangements
- Hamilton County Hospital District structure
- Coryell County Hospital Authority structure
