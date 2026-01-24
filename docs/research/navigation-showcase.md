# Atlas Database - Navigation Showcase

> **Bidirectional Data Model Demonstration**
> Starting from ONE property, navigate the entire ownership network

---

## The Property

### Tarzana Health and Rehabilitation Center

| Field | Value |
|-------|-------|
| Address | 5650 Reseda Blvd, Tarzana, CA 91356 |
| CCN | 056124 |
| Property ID | 1018 |

### CMS Quality Ratings

| Metric | Rating |
|--------|--------|
| Overall | 1/5 |
| Health Inspection | 1/5 |
| Staffing | 3/5 |
| Quality Measures | 3/5 |
| Rating Date | 1/22/2026 |

---

## Entity Relationships

### Owner
- **Entity:** Smv Tarzana Lp
- **Company:** SABRA HEALTH CARE REIT (ownership)

### Operator
- **Entity:** TARZANA POST ACUTE LLC
- **Company:** DAVID & FRANK JOHNSON (owner_operator)

### Lenders (6)
| Entity | Company |
|--------|---------|
| CAPITAL FUNDING | CAPITAL FUNDING (lending) |
| COLUMN FINANCIAL INC | COLUMN FINANCIAL (lending) |
| DEUTSCHE BANK NATIONAL TRUST CO | DEUTSCHE BANK NATIONAL TRUST CO (lending) |
| GERMAN AMERICAN CAPITAL CORPORATION | GERMAN AMERICAN CAPITAL (lending) |
| ALLY BANK | ALLY BANK (lending) |
| CANADIAN IMPERIAL BANK OF COMMERCE | CANADIAN IMPERIAL BANK OF COMMERCE (lending) |

### Buyer
- **Entity:** Smv Tarzana Lp
- **Company:** Smv Tarzana Llc (other)

### Seller
- **Entity:** Grancare Llc
- **Company:** Grancare Llc (other)

### Borrowers
- Grancare Llc
- Smv Tarzana Llc

---

## Deal History & Financials

### Summary

| Metric | Value |
|--------|-------|
| Total Deals | 12 |
| Mortgages | 10 ($3.76B total) |
| Sales | 1 ($4.8M total) |
| CHOWs | 1 |

### Deal Timeline

| Date | Type | Amount | Details |
|------|------|--------|---------|
| 3/13/2025 | Mortgage | $325.0M | Commercial - Ally Bank |
| 8/24/2021 | Mortgage | $262.6M | Commercial - Capital Funding Llc |
| 7/1/2021 | CHOW | - | Change of Ownership |
| 1/11/2019 | Mortgage | $0.3M | Commercial - Column Financial Inc |
| 1/1/2018 | Mortgage | $50.5M | Aggregate Amount - Capital Funding |
| 10/11/2016 | Mortgage | $710.0M | Commercial - Deutsche Bank National Trust Co |
| 6/2/2014 | Mortgage | $700.0M | Commercial - German American Capital Corporation |
| 6/20/2006 | Mortgage | $820.0M | Column Financial Inc |
| 6/9/2006 | Mortgage | $800.0M | Commercial - Column Financial Inc |
| 12/10/2004 | Sale | $4.8M | Buyer: Smv Tarzana Lp / Seller: Grancare Llc |
| 12/19/2003 | Mortgage | $90.0M | Credit Line (Revolving) - Canadian Imperial Bank Of Commerce |

---

## Owner Company Deep Dive

### SABRA HEALTH CARE REIT
**Type:** ownership

| Metric | Value |
|--------|-------|
| Total Properties Owned | 283 |
| Geographic Reach | 32 states |

### Geographic Distribution (Top 10 States)

| State | Properties |
|-------|------------|
| TX | 76 |
| CA | 26 |
| CO | 19 |
| OR | 14 |
| NC | 13 |
| IN | 12 |
| MD | 10 |
| WA | 9 |
| KY | 9 |
| NY | 9 |

### Sample Properties in Portfolio
- Belle View Estates Rehabilitation and Care Center (Monticello, AR)
- Bay View Rehabilitation Hospital, LLC (Alameda, CA)
- Coventry Court Health Center (Anaheim, CA)
- Garden View Post Acute Rehabilitation (Baldwin Park, CA)
- Mission Carmichael Healthcare Center (Carmichael, CA)
- Chatsworth Park Health Care Center (Chatsworth, CA)
- Corona Regional Medical Center D/P SNF (Corona, CA)
- Golden Heights Healthcare (Daly City, CA)
- *...and 275 more*

### Operating Partners

| Company | Properties |
|---------|------------|
| THE ENSIGN GROUP | 27 |
| AVAMERE | 21 |
| SIGNATURE HEALTHCARE | 12 |
| FANNIN COUNTY HOSPITAL AUTHORITY | 12 |
| UVALDE COUNTY HOSPITAL AUTHORITY | 10 |
| FOCUSED POST ACUTE CARE PARTNERS | 9 |
| OAKBEND MEDICAL CENTER | 9 |
| CCH HEALTHCARE | 8 |
| HAMILTON COUNTY HOSPITAL DISTRICT | 8 |
| ERICKSON SENIOR LIVING | 6 |

### Financing Partners

| Lender | Properties | Volume |
|--------|------------|--------|
| COLUMN FINANCIAL | 53 | $105.5B |
| GERMAN AMERICAN CAPITAL | 51 | $102.6B |
| CAPITAL FUNDING | 25 | $55.0B |
| DEUTSCHE BANK NATIONAL TRUST CO | 25 | $60.4B |
| CANADIAN IMPERIAL BANK OF COMMERCE | 17 | $43.0B |
| ALLY BANK | 15 | $34.2B |
| ISRAEL DISCOUNT BANK OF NEW YORK | 8 | $14.9B |
| DBA GMAC RFC HEALTH CAPITAL | 7 | $12.9B |
| TRUIST BANK | 7 | $2.5B |
| GENERAL ELECTRIC CAPITAL | 5 | $0.9B |

---

## Operator Company Analysis

### DAVID & FRANK JOHNSON
**Type:** owner_operator

| Metric | Value |
|--------|-------|
| Total Properties Operated | 40 |
| Geographic Reach | 1 state (CA) |

### Property Owners They Work With

| Owner | Type | Properties |
|-------|------|------------|
| CASCADE CAPITAL GROUP | owner_operator | 9 |
| OMEGA HEALTHCARE INVESTORS | ownership | 7 |
| SABRA HEALTH CARE REIT | ownership | 4 |
| PACS GROUP | owner_operator | 1 |
| FINANCING VI/MADISON | ownership | 1 |

---

## Lender Analysis

This property has **6 lenders** in its history:

| Lender | Portfolio Size | States |
|--------|---------------|--------|
| CAPITAL FUNDING | 334 properties | 32 |
| COLUMN FINANCIAL | 210 properties | 34 |
| DEUTSCHE BANK NATIONAL TRUST CO | 64 properties | 20 |

---

## Navigation Paths Demonstrated

```
From this ONE property, we navigated to:

    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │   OWNER     │────>│  PORTFOLIO  │────>│  OPERATORS  │
    │  COMPANY    │     │ (283 props) │     │  (partners) │
    └─────────────┘     └─────────────┘     └─────────────┘
           │                                       │
           v                                       v
    ┌─────────────┐                         ┌─────────────┐
    │   LENDERS   │<────────────────────────│  FINANCING  │
    │  (6 banks)  │                         │   HISTORY   │
    └─────────────┘                         └─────────────┘
           │                                       │
           v                                       v
    ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
    │   OTHER     │     │   DEALS     │     │   MARKET    │
    │ PROPERTIES  │     │  (12 deals) │     │   COMPS     │
    └─────────────┘     └─────────────┘     └─────────────┘
```

**Ready for CRM Principals to complete the network!**

---

## Data Model Summary

| Entity Type | Count |
|-------------|-------|
| Properties | 14,054 |
| Companies | 9,749 |
| Entities | 29,508 |
| Principals | 47,386 |
| Deals | 29,365 |

### Relationship Coverage

| Relationship Type | Count | Properties | Coverage |
|-------------------|-------|------------|----------|
| property_owner | 14,094 | 14,054 | 100.0% |
| facility_operator | 14,054 | 14,054 | 100.0% |
| lender | 12,200 | 6,871 | 48.9% |
| property_borrower | 4,818 | 3,859 | 27.5% |
| property_buyer | 2,242 | 2,172 | 15.5% |
| property_seller | 2,061 | 1,894 | 13.5% |
