# Default Chart of Accounts Templates

This reference file contains recommended charts of accounts for different business types. Use
these templates when setting up a new business from scratch (Path B) or when a migrating business
needs to supplement or restructure their imported accounts.

Choose the template that best matches the business, then customise based on what the user tells
you about their specific situation. It is always better to start with more accounts than fewer
— unused accounts can be deactivated, but missing accounts cause postings to go to the wrong place.

---

## Template 1 — Service Business

**Best for:** Consultants, agencies, freelancers, coaches, marketing firms, IT service providers,
designers, architects, and anyone who sells time and expertise rather than physical goods.

**Key characteristics:** No stock, no cost of goods sold, high overhead ratio, often project-based.

| Code | Name | Type | Category |
|------|------|------|----------|
| **Assets** | | | |
| 1000 | Bank Current Account | ASSET | CURRENT_ASSET |
| 1050 | Bank Deposit Account | ASSET | CURRENT_ASSET |
| 1100 | Trade Debtors | ASSET | CURRENT_ASSET |
| 1200 | VAT Input Recoverable | ASSET | CURRENT_ASSET |
| 1400 | Prepayments | ASSET | CURRENT_ASSET |
| 1500 | Fixed Assets Cost | ASSET | FIXED_ASSET |
| 1510 | Fixed Assets Accum Depreciation | ASSET | FIXED_ASSET |
| **Liabilities** | | | |
| 2000 | Trade Creditors | LIABILITY | CURRENT_LIABILITY |
| 2050 | Other Creditors | LIABILITY | CURRENT_LIABILITY |
| 2100 | VAT Output | LIABILITY | CURRENT_LIABILITY |
| 2150 | Accruals | LIABILITY | CURRENT_LIABILITY |
| 2200 | PAYE/NI Payable | LIABILITY | CURRENT_LIABILITY |
| **Equity** | | | |
| 3000 | Share Capital | EQUITY | EQUITY |
| 3100 | Retained Earnings | EQUITY | EQUITY |
| **Revenue** | | | |
| 4000 | Consulting Revenue | REVENUE | REVENUE |
| 4100 | Other Revenue | REVENUE | REVENUE |
| 7000 | Bank Interest Received | REVENUE | OTHER_INCOME |
| **Expenses** | | | |
| 6000 | Wages and Salaries | EXPENSE | OVERHEADS |
| 6100 | Rent and Rates | EXPENSE | OVERHEADS |
| 6200 | Office Supplies | EXPENSE | OVERHEADS |
| 6300 | Professional Fees | EXPENSE | OVERHEADS |
| 6400 | Travel and Subsistence | EXPENSE | OVERHEADS |
| 6500 | Software Subscriptions | EXPENSE | OVERHEADS |
| 6600 | Marketing and Advertising | EXPENSE | OVERHEADS |
| 6700 | Depreciation | EXPENSE | OVERHEADS |
| 7100 | Bank Charges | EXPENSE | FINANCE_COSTS |

**Customisation suggestions:**
- If the business has contractors or freelancers, add 5000 Subcontractor Costs (EXPENSE / DIRECT_COSTS)
- If they have a significant amount of equipment (e.g., a photography studio), expand 1500/1510 into
  separate fixed asset categories
- If they have multiple revenue streams, split 4000 into specific service lines (e.g., 4010 Strategy
  Consulting, 4020 Implementation, 4030 Training)

---

## Template 2 — Retail Business

**Best for:** Shops (bricks-and-mortar or online), e-commerce businesses, product resellers,
distributors, importers, and anyone who buys goods and sells them on.

**Key characteristics:** Holds stock, has cost of goods sold, may have postage/packaging costs,
may have multiple sales channels.

| Code | Name | Type | Category |
|------|------|------|----------|
| **Assets** | | | |
| 1000 | Bank Current Account | ASSET | CURRENT_ASSET |
| 1050 | Bank Deposit Account | ASSET | CURRENT_ASSET |
| 1100 | Trade Debtors | ASSET | CURRENT_ASSET |
| 1200 | VAT Input Recoverable | ASSET | CURRENT_ASSET |
| 1300 | Stock | ASSET | CURRENT_ASSET |
| 1350 | Goods Received Not Invoiced | ASSET | CURRENT_ASSET |
| 1400 | Prepayments | ASSET | CURRENT_ASSET |
| 1500 | Fixed Assets Cost | ASSET | FIXED_ASSET |
| 1510 | Fixed Assets Accum Depreciation | ASSET | FIXED_ASSET |
| **Liabilities** | | | |
| 2000 | Trade Creditors | LIABILITY | CURRENT_LIABILITY |
| 2050 | Other Creditors | LIABILITY | CURRENT_LIABILITY |
| 2100 | VAT Output | LIABILITY | CURRENT_LIABILITY |
| 2150 | Accruals | LIABILITY | CURRENT_LIABILITY |
| 2200 | PAYE/NI Payable | LIABILITY | CURRENT_LIABILITY |
| **Equity** | | | |
| 3000 | Share Capital | EQUITY | EQUITY |
| 3100 | Retained Earnings | EQUITY | EQUITY |
| **Revenue** | | | |
| 4000 | Sales Revenue — Trade | REVENUE | REVENUE |
| 4100 | Shipping Revenue | REVENUE | REVENUE |
| 4200 | Other Income | REVENUE | OTHER_INCOME |
| 7000 | Bank Interest Received | REVENUE | OTHER_INCOME |
| **Cost of Sales** | | | |
| 5000 | Cost of Goods Sold | EXPENSE | DIRECT_COSTS |
| 5100 | Purchases — Stock | EXPENSE | DIRECT_COSTS |
| 5200 | Postage and Packaging | EXPENSE | DIRECT_COSTS |
| 5300 | Import Duties and Freight | EXPENSE | DIRECT_COSTS |
| **Overheads** | | | |
| 6000 | Wages and Salaries | EXPENSE | OVERHEADS |
| 6100 | Rent and Rates | EXPENSE | OVERHEADS |
| 6200 | Utilities | EXPENSE | OVERHEADS |
| 6300 | Office Supplies | EXPENSE | OVERHEADS |
| 6400 | Professional Fees | EXPENSE | OVERHEADS |
| 6500 | Travel and Subsistence | EXPENSE | OVERHEADS |
| 6600 | Marketing and Advertising | EXPENSE | OVERHEADS |
| 6700 | Depreciation | EXPENSE | OVERHEADS |
| 7100 | Bank Charges | EXPENSE | FINANCE_COSTS |

**Customisation suggestions:**
- If they sell on multiple channels (e.g., own website + Amazon + retail), split 4000 by channel:
  4010 Direct Sales, 4020 Marketplace Sales, 4030 Wholesale
- If they do their own fulfilment, 5200 Postage and Packaging is important
- If they import goods, 5300 Import Duties and Freight is essential
- For e-commerce businesses, consider 6800 Platform Fees (Shopify, eBay, Amazon fees)

---

## Template 3 — Construction and Trades Business

**Best for:** Builders, electricians, plumbers, joiners, painters, civil engineers, fit-out
contractors, and any business that completes work on buildings or infrastructure.

**Key characteristics:** High materials cost, use of subcontractors, plant and equipment,
CIS (Construction Industry Scheme) deductions if in the UK.

| Code | Name | Type | Category |
|------|------|------|----------|
| **Assets** | | | |
| 1000 | Bank Current Account | ASSET | CURRENT_ASSET |
| 1050 | Bank Deposit Account | ASSET | CURRENT_ASSET |
| 1100 | Trade Debtors | ASSET | CURRENT_ASSET |
| 1200 | VAT Input Recoverable | ASSET | CURRENT_ASSET |
| 1300 | Materials Stock | ASSET | CURRENT_ASSET |
| 1350 | Work in Progress | ASSET | CURRENT_ASSET |
| 1400 | Prepayments | ASSET | CURRENT_ASSET |
| 1500 | Plant and Equipment Cost | ASSET | FIXED_ASSET |
| 1510 | Plant and Equipment Accum Depn | ASSET | FIXED_ASSET |
| 1520 | Motor Vehicles Cost | ASSET | FIXED_ASSET |
| 1530 | Motor Vehicles Accum Depn | ASSET | FIXED_ASSET |
| **Liabilities** | | | |
| 2000 | Trade Creditors | LIABILITY | CURRENT_LIABILITY |
| 2050 | Other Creditors | LIABILITY | CURRENT_LIABILITY |
| 2100 | VAT Output | LIABILITY | CURRENT_LIABILITY |
| 2150 | Accruals | LIABILITY | CURRENT_LIABILITY |
| 2200 | PAYE/NI Payable | LIABILITY | CURRENT_LIABILITY |
| 2250 | CIS Deductions Payable | LIABILITY | CURRENT_LIABILITY |
| **Equity** | | | |
| 3000 | Share Capital | EQUITY | EQUITY |
| 3100 | Retained Earnings | EQUITY | EQUITY |
| **Revenue** | | | |
| 4000 | Contract Revenue | REVENUE | REVENUE |
| 4100 | Labour Revenue | REVENUE | REVENUE |
| 4200 | Materials Revenue (recharged) | REVENUE | REVENUE |
| 4300 | Plant Hire Revenue | REVENUE | REVENUE |
| 7000 | Bank Interest Received | REVENUE | OTHER_INCOME |
| **Cost of Sales** | | | |
| 5000 | Subcontractor Costs | EXPENSE | DIRECT_COSTS |
| 5100 | Materials — Direct | EXPENSE | DIRECT_COSTS |
| 5200 | Plant Hire | EXPENSE | DIRECT_COSTS |
| 5300 | Site Labour | EXPENSE | DIRECT_COSTS |
| **Overheads** | | | |
| 6000 | Office Wages and Salaries | EXPENSE | OVERHEADS |
| 6100 | Rent and Rates | EXPENSE | OVERHEADS |
| 6200 | Utilities | EXPENSE | OVERHEADS |
| 6300 | Professional Fees | EXPENSE | OVERHEADS |
| 6400 | Travel and Subsistence | EXPENSE | OVERHEADS |
| 6500 | Motor Expenses | EXPENSE | OVERHEADS |
| 6600 | Depreciation | EXPENSE | OVERHEADS |
| 6700 | Tools and Equipment (small items) | EXPENSE | OVERHEADS |
| 6800 | Insurance | EXPENSE | OVERHEADS |
| 7100 | Bank Charges | EXPENSE | FINANCE_COSTS |
| 7200 | Loan Interest | EXPENSE | FINANCE_COSTS |

**Customisation suggestions:**
- 2250 CIS Deductions Payable is important for UK construction businesses registered as contractors
- Split 4000 by project type if needed (residential, commercial, infrastructure)
- 1350 Work in Progress tracks costs on uncompleted contracts — important for accurate P&L timing
- If they have a significant fleet of vehicles, expand 1520/1530 by vehicle

---

## Template 4 — Restaurant and Hospitality

**Best for:** Restaurants, cafes, pubs, bars, hotels, catering businesses, food trucks, and
any business where food and drink service is the core product.

**Key characteristics:** High food and beverage cost, tip handling, staff-intensive, possibly
accommodation revenue.

| Code | Name | Type | Category |
|------|------|------|----------|
| **Assets** | | | |
| 1000 | Bank Current Account | ASSET | CURRENT_ASSET |
| 1050 | Bank Deposit Account | ASSET | CURRENT_ASSET |
| 1060 | Cash Float | ASSET | CURRENT_ASSET |
| 1100 | Trade Debtors | ASSET | CURRENT_ASSET |
| 1200 | VAT Input Recoverable | ASSET | CURRENT_ASSET |
| 1300 | Food Stock | ASSET | CURRENT_ASSET |
| 1310 | Beverage Stock | ASSET | CURRENT_ASSET |
| 1400 | Prepayments | ASSET | CURRENT_ASSET |
| 1500 | Kitchen Equipment Cost | ASSET | FIXED_ASSET |
| 1510 | Kitchen Equipment Accum Depn | ASSET | FIXED_ASSET |
| 1520 | Furniture and Fittings Cost | ASSET | FIXED_ASSET |
| 1530 | Furniture and Fittings Accum Depn | ASSET | FIXED_ASSET |
| **Liabilities** | | | |
| 2000 | Trade Creditors | LIABILITY | CURRENT_LIABILITY |
| 2050 | Other Creditors | LIABILITY | CURRENT_LIABILITY |
| 2100 | VAT Output | LIABILITY | CURRENT_LIABILITY |
| 2150 | Accruals | LIABILITY | CURRENT_LIABILITY |
| 2200 | PAYE/NI Payable | LIABILITY | CURRENT_LIABILITY |
| 2300 | Tips Liability | LIABILITY | CURRENT_LIABILITY |
| **Equity** | | | |
| 3000 | Share Capital | EQUITY | EQUITY |
| 3100 | Retained Earnings | EQUITY | EQUITY |
| **Revenue** | | | |
| 4000 | Food Sales | REVENUE | REVENUE |
| 4100 | Beverage Sales | REVENUE | REVENUE |
| 4200 | Accommodation Revenue | REVENUE | REVENUE |
| 4300 | Private Hire and Events | REVENUE | REVENUE |
| 4400 | Tips and Service Charge | REVENUE | OTHER_INCOME |
| 7000 | Other Income | REVENUE | OTHER_INCOME |
| **Cost of Sales** | | | |
| 5000 | Food Purchases | EXPENSE | DIRECT_COSTS |
| 5100 | Beverage Purchases | EXPENSE | DIRECT_COSTS |
| 5200 | Packaging and Disposables | EXPENSE | DIRECT_COSTS |
| **Overheads** | | | |
| 6000 | Wages and Salaries | EXPENSE | OVERHEADS |
| 6050 | Staff Meals | EXPENSE | OVERHEADS |
| 6100 | Rent and Rates | EXPENSE | OVERHEADS |
| 6200 | Utilities (Gas, Electric, Water) | EXPENSE | OVERHEADS |
| 6300 | Cleaning and Laundry | EXPENSE | OVERHEADS |
| 6400 | Professional Fees | EXPENSE | OVERHEADS |
| 6500 | Marketing and Promotions | EXPENSE | OVERHEADS |
| 6600 | Depreciation | EXPENSE | OVERHEADS |
| 6700 | Repairs and Maintenance | EXPENSE | OVERHEADS |
| 7100 | Bank Charges | EXPENSE | FINANCE_COSTS |

**Notes:**
- 2300 Tips Liability: In the UK, tips paid to employees through the business must be accounted
  for separately. The tips belong to the staff, not the business.
- 4400 Tips and Service Charge: Record tips and service charges collected, then distribute to 2300.
- 5000/5100 split: Tracking food cost % and beverage cost % separately is standard in hospitality.
- 1300/1310 split: Separate food and beverage stock for easier cost analysis.

---

## Template 5 — Professional Services

**Best for:** Accountants, solicitors, dentists, doctors (private practice), architects,
surveyors, financial advisers, and anyone who provides regulated or licensed professional services.

**Key characteristics:** High labour cost, significant professional overheads (insurance, CPD,
regulatory fees), often has work in progress, may have client money accounts.

| Code | Name | Type | Category |
|------|------|------|----------|
| **Assets** | | | |
| 1000 | Bank Current Account | ASSET | CURRENT_ASSET |
| 1050 | Client Money Account | ASSET | CURRENT_ASSET |
| 1100 | Trade Debtors | ASSET | CURRENT_ASSET |
| 1200 | VAT Input Recoverable | ASSET | CURRENT_ASSET |
| 1400 | Work in Progress | ASSET | CURRENT_ASSET |
| 1410 | Prepayments | ASSET | CURRENT_ASSET |
| 1500 | Leasehold Improvements Cost | ASSET | FIXED_ASSET |
| 1510 | Leasehold Improvements Accum Depn | ASSET | FIXED_ASSET |
| 1520 | Office Equipment Cost | ASSET | FIXED_ASSET |
| 1530 | Office Equipment Accum Depn | ASSET | FIXED_ASSET |
| **Liabilities** | | | |
| 2000 | Trade Creditors | LIABILITY | CURRENT_LIABILITY |
| 2050 | Client Money Liability | LIABILITY | CURRENT_LIABILITY |
| 2100 | VAT Output | LIABILITY | CURRENT_LIABILITY |
| 2150 | Accruals | LIABILITY | CURRENT_LIABILITY |
| 2200 | PAYE/NI Payable | LIABILITY | CURRENT_LIABILITY |
| **Equity** | | | |
| 3000 | Share Capital / Partners Capital | EQUITY | EQUITY |
| 3100 | Retained Earnings / Accumulated Profit | EQUITY | EQUITY |
| **Revenue** | | | |
| 4000 | Fees — Core Services | REVENUE | REVENUE |
| 4100 | Fees — Other Services | REVENUE | REVENUE |
| 4200 | Disbursements Recovered | REVENUE | REVENUE |
| 7000 | Bank Interest Received | REVENUE | OTHER_INCOME |
| **Expenses** | | | |
| 6000 | Wages and Salaries | EXPENSE | OVERHEADS |
| 6050 | Partners / Director Drawings | EXPENSE | OVERHEADS |
| 6100 | Rent and Rates | EXPENSE | OVERHEADS |
| 6200 | Professional Indemnity Insurance | EXPENSE | OVERHEADS |
| 6210 | Other Insurance | EXPENSE | OVERHEADS |
| 6300 | CPD and Training | EXPENSE | OVERHEADS |
| 6310 | Professional Subscriptions | EXPENSE | OVERHEADS |
| 6320 | Regulatory and Licensing Fees | EXPENSE | OVERHEADS |
| 6400 | Stationery and Office Supplies | EXPENSE | OVERHEADS |
| 6500 | IT and Software | EXPENSE | OVERHEADS |
| 6600 | Marketing and Business Development | EXPENSE | OVERHEADS |
| 6700 | Travel and Subsistence | EXPENSE | OVERHEADS |
| 6800 | Depreciation | EXPENSE | OVERHEADS |
| 7100 | Bank Charges | EXPENSE | FINANCE_COSTS |

**Notes:**
- 1050 / 2050 Client Money: Solicitors, financial advisers, and others who hold client funds must
  track these as an asset (the money in the client account) and an equal liability (what you owe to
  clients). These should always balance each other.
- 1400 Work in Progress: Fees earned but not yet billed. Important for accurate revenue recognition
  under accounting standards.
- 6310 / 6320: Professional services firms often have significant regulatory costs — annual
  practising certificates, FCA authorisation, SRA registration, etc. Worth tracking separately.

---

## How to Choose and Customise a Template

When the user describes their business, use this quick guide to choose the right template:

| Business Description | Template |
|---------------------|----------|
| "I'm a consultant / freelancer / agency" | Template 1 — Service |
| "We sell products / we have a shop / e-commerce" | Template 2 — Retail |
| "We're in construction / building / trades" | Template 3 — Construction |
| "We run a restaurant / pub / cafe / hotel" | Template 4 — Restaurant |
| "I'm an accountant / solicitor / doctor / dentist" | Template 5 — Professional Services |
| "We're a manufacturer" | Template 2 + add raw materials and production accounts |
| "We're a charity / non-profit" | Template 1 + replace Revenue with Income (donations, grants) |
| "We're a property business" | Template 2 + add property-specific accounts |

After choosing a template, always ask:
1. "Is there anything in this list that doesn't apply to your business?"
2. "Are there any specific costs or income streams that aren't covered here?"
3. "Do you track costs by department, project, or location?" (If yes, cost centre codes may be needed)

Remember: the goal is a chart of accounts that is detailed enough to be useful but not so
complex that day-to-day posting becomes a chore. Aim for 20–50 accounts for most small businesses.
