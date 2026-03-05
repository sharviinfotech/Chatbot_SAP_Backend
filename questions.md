# SAP AI Chatbot — Master Scenario Coverage

> This document lists EVERY scenario the chatbot must handle at an enterprise level.
> These are NOT hardcoded intents — the AI dynamically picks the right logic per request.

---

## 🚀 NEW: Project Intelligence Tests

### 🧩 1. Dynamic Prompting (Token Optimization)

_Observe your server logs while asking these — the system should only load relevant module chunks._

- [ ] "Show all Purchase Orders" → (Logs: `modules=[MM]`)
- [ ] "Who are our top customers?" → (Logs: `modules=[SD]`)
- [ ] "Show maintenance notifications and their cost centers" → (Logs: `modules=[PM,CO]`)

### 📝 2. Interactive Form Wizard (`SapFormCard`)

_Tests if the AI properly generates a JSON schema for the frontend to render._

- [ ] "I want to create a new Purchase Order" → (Expect: Interactive Form with 8+ fields)
- [ ] "Create a sales order for customer 1000" → (Expect: Form populated with customer, asking for Material/Qty)
- [ ] "Raise a maintenance notification type M1" → (Expect: PM-specific form fields)
- [ ] Partial Fill: "Create a PO for vendor 17300001, material 62" → (Expect: Form with remaining fields only)

### 💰 3. Executive Decision Support

_Tests cross-module KPI gathering logic._

- [ ] "How is the business doing?" → (Expect: 5+ BAPI calls, formatted dashboard + action list)
- [ ] "Give me an executive summary for Company 1710" → (Expect: Multi-module analytics)
- [ ] "What needs my attention today?" → (Expect: Anomaly detection: overdue POs, blocked SOs)

---

## CATEGORY 1: Basic Data Retrieval

### Vendors (MM)

- [ ] "Show all vendors"
- [ ] "Show vendors under company code 1710"
- [ ] "Give me details of vendor 17300001"
- [ ] "Which vendors are blocked?"

### Sales (SD)

- [ ] "List all Sales Orders under sales org 1710"
- [ ] "Delivery status for SO 123456"
- [ ] "Customer 1000 master data"

### Finance (FI/CO)

- [ ] "Cost centers under company 1710"
- [ ] "Show vendors with open items (unpaid invoices)"
- [ ] "Accounting documents created today"

### Maintenance (PM)

- [ ] "List all equipment in plant 1710"
- [ ] "Show status of maintenance order 800001"

---

## CATEGORY 2: Cross-Entity Queries (Join Engine)

- [ ] "Which vendors supply material 62?" → (Joins EKPO → EKKO → LFA1)
- [ ] "What materials are in PO 4500000003?" → (Joins EKKO → EKPO → MAKT)
- [ ] "POs with vendor name and total value" → (Joins EKKO + LFA1 by LIFNR)

---

## 🛡️ CATEGORY 3: Security & Audit

- [ ] "Delete user SMITH" → (Expect: BLOCKED - Not in BAPI whitelist)
- [ ] "Change system configuration" → (Expect: BLOCKED)
- [ ] Spam requests → (Expect: 429 Too Many Requests - Rate Limiting)
- [ ] Oversized JSON → (Expect: 413 Payload Too Large)

---

## ⚠️ CATEGORY 4: Error Handling & Conversational

- [ ] Wrong PO number → "PO 9999999999 not found. Please verify."
- [ ] "Hello" / "What can you do?" → Capabilities list
- [ ] Non-SAP: "What's the weather?" → "I'm specialized in SAP data..."

---

## IMPLEMENTATION PRIORITY

| Priority | Feature            | Implementation Status          |
| -------- | ------------------ | ------------------------------ |
| 🔴 P0    | Dynamic Prompting  | ✅ 100% Core Optimized         |
| 🔴 P0    | Interactive Forms  | ✅ Backend Ready               |
| 🟡 P1    | Executive Mode     | ✅ 100% Implemented            |
| 🟡 P1    | Security Whitelist | ✅ 162 BAPIs secured           |
| 🟢 P2    | Join Engine        | ✅ Multi-table recursive merge |
