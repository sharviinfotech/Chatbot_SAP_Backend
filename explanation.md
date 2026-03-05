# The SAP Conversational Middleware - Architecture Deep Dive

This document explains the "Why" and "How" of our most advanced engineering features.

---

## 1. Dynamic Prompt Assembly (Token Optimization)

**The Problem:** Our master SAP prompt contains definitions for 10+ modules (MM, SD, FI, etc.) and ~200 BAPIs. Sending all this in every message used ~15,000 tokens, which is slow and expensive.

**The Solution:**
We built a **Module Detector** in the middleware.

1. When a user sends a message, the server scans it for keywords (e.g., "PO" → MM, "Invoice" → FI).
2. It dynamically stitches together the prompt using only the relevant "Module Chunks."
3. **Result:** A query for a Purchase Order now only uses ~1,500 tokens instead of 15,000. It's **10x faster** and **90% cheaper** without losing any intelligence.

---

## 2. Interactive Form Wizard (AI-Generated UI)

**The Problem:** Users shouldn't have to type 10 fields into a chat box. It leads to typos and frustration.

**The Solution:**
Instead of hardcoding forms, we taught the AI to generate **UI Schemas**.

1. If the user wants to "Create a PO" but is missing fields, the AI returns a `formFields` array.
2. Each field in the array defines its `key`, `label`, `type` (text/date/number), and `required` status.
3. The React frontend (via `SapFormCard.jsx`) detects this array and instantly renders a **Real Interactive Form**.
4. **Zero Hardcoding:** Because the AI generates the fields based on the BAPI definition in its prompt, we can generate forms for _any_ SAP BAPI (even new ones) without writing new frontend code.

---

## 3. The Progressive N-Table Join Engine

SAP's generic `RFC_READ_TABLE` cannot do SQL Joins. If we want Vendor data (`LFA1`) and PO Data (`EKKO`), we have to stitch it ourselves.

1. The AI generates an array of MULTIPLE `RFC_READ_TABLE` calls simultaneously.
2. The middleware has a JavaScript **Merge Engine**. It maps `COMMON_KEYS` (like `LIFNR` for Vendor No, `EBELN` for PO No).
3. It recursively maps parent rows to child rows on the fly, creating one master composite object.

---

## 4. Enterprise-Grade Security (BAPI Whitelist)

To prevent unauthorized SAP commands, we implemented a **Strict Whitelist** in `server.js`:

- Only ~162 specific BAPIs/RFCs are allowed.
- Any AI hallucination or attempt to call a dangerous function (like `BAPI_USER_DELETE`) is caught at the middleware layer and blocked before it touches SAP.
- The system also enforces **Rate Limiting** (60 req/min/IP) and **Size Limits** to protect the OpenAI and SAP connections.

---

## 5. Stateful Transaction Commits (LUW)

Normally REST is stateless. But SAP transactions (like PO Creation) require a "Logical Unit of Work" (LUW).

1. We send `BAPI_PO_CREATE1`.
2. SAP returns a temporary PO Number.
3. We instantly call `BAPI_TRANSACTION_COMMIT` on the **exact same open TCP session.**
4. Once the commit resolves, the document is permanently saved in the HANA database.

---

## 6. Auto-Resolving Buffer Overflows (Error 559)

SAP limits generic data streams to 512 characters per row. If you query too many columns, it crashes.
**Our Solution:** The server intercepts queries. If the AI forgets to specify columns, the server auto-injects an optimal list of "SAFE FIELDS" for that table, guaranteeing the 512-limit is never hit.
