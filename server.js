require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const jwt     = require("jsonwebtoken");
const { Client } = require("node-rfc");
const axios   = require("axios");
const { SAP_PASS1_PROMPT, SAP_PASS2_PROMPT } = require("./prompts/sapInterpreter");
 
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
 
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:5173"];
 
/* ===============================
   SAP SYSTEM CONFIG
================================= */
 
const SAP_SYSTEM_CONFIGS = {
  PRD: { ashost: "49.207.9.62", sysnr: "25", client: "100", description: "S4H 2023" },
  QAS: { ashost: "49.207.9.62", sysnr: "25", client: "100", description: "S4H 2023" },
  DEV: { ashost: "49.207.9.62", sysnr: "25", client: "100", description: "S4H 2023" }
};
 
/* ===============================
   SAP BUSINESS DEFAULTS
   (Change here — nowhere else)
================================= */
 
const SAP_DEFAULTS = {
  companyCode    : "1000",  // Default company code
  purchasingOrg  : "1000",  // Default purchasing organisation
  purchasingGroup: "001",   // Default purchasing group
  plant          : "1000",  // Default plant
  documentType   : "NB",    // Standard purchase order
  currency       : "USD",   // Default currency
 
  // Module routing (as per summary.md enterprise architecture)
  modules: {
    FI: ["Vendor", "Invoice", "Customer", "CompanyCode"],     // Finance
    MM: ["PurchaseOrder", "PurchaseRequisition", "Material"], // Materials Management
  }
};
 
/* ===============================
   MIDDLEWARE
================================= */
 
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());
app.use((req, res, next) => {
  if (req.path === "/api/sap/login" || req.path === "/api/health") {
    return next();
  }
  authenticate(req, res, next);
});
 
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });
 
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}
 
app.use((req, res, next) => {
  if (req.method !== "OPTIONS") {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});
 
/* ===============================
   HEALTH CHECK
================================= */
 
app.get("/api/health", (_, res) => {
  res.json({ status: "ok" });
});
 
/* ===============================
   SAP LOGIN
================================= */
 
app.post("/api/sap/login", async (req, res) => {
  const { system, client, userId, password, language } = req.body;
 
  if (!SAP_SYSTEM_CONFIGS[system])
    return res.status(400).json({ message: "Invalid SAP system" });
 
  const connParams = {
    ashost: SAP_SYSTEM_CONFIGS[system].ashost,
    sysnr: SAP_SYSTEM_CONFIGS[system].sysnr,
    client,
    user: userId,
    passwd: password,
    lang: language || "EN"
  };
 
  let rfcClient;
  try {
    rfcClient = new Client(connParams);
    await rfcClient.open();
 
    const result = await rfcClient.call("BAPI_USER_GET_DETAIL", {
      USERNAME: userId.toUpperCase()
    });
 
    const token = jwt.sign(
      { userId, client, system },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
 
    res.json({
      token,
      user: {
        userId,
        firstName: result.ADDRESS?.FIRSTNAME,
        lastName: result.ADDRESS?.LASTNAME,
        email: result.ADDRESS?.E_MAIL,
        client,
        system: SAP_SYSTEM_CONFIGS[system].description
      }
    });
 
  } catch (err) {
    return res.status(401).json({ message: err.message });
  } finally {
    if (rfcClient) await rfcClient.close();
  }
});
 
/* ===============================
   GET USER INFO
================================= */
 
app.get("/api/sap/user-info", authenticate, (req, res) => {
  res.json(req.user);
});
 
/* ===============================
   RFC_READ_TABLE PARSER
================================= */
 
function parseRfcTable(data, fields, delimiter = "~") {
  return (data || []).map(row => {
    const values = (row.WA || "").split(delimiter);
    const result = {};
    (fields || []).forEach((f, i) => {
      result[f.FIELDNAME] = (values[i] || "").trim();
    });
    return result;
  });
}
 
/* ===============================
   FETCH VENDORS  (LFB1 + LFA1)
   Avoids BAPI_VENDOR_GETLIST auth
================================= */
 
async function fetchVendorsByCompanyCode(userTokenData, companyCode, search = "") {
  // Step 1 — Read LFB1 (company-code-specific vendor data)
  const lfb1Res = await executeSapRfc(userTokenData, "RFC_READ_TABLE", {
    QUERY_TABLE: "LFB1",
    DELIMITER:   "~",
    FIELDS: [
      { FIELDNAME: "LIFNR" },
      { FIELDNAME: "BUKRS" },
      { FIELDNAME: "ZTERM" },   // Payment Terms
      { FIELDNAME: "AKONT" }    // Recon Account
    ],
    OPTIONS: [{ TEXT: `BUKRS EQ '${companyCode}'` }],
    ROWCOUNT: 200
  });
 
  const lfb1Rows = parseRfcTable(lfb1Res.DATA, lfb1Res.FIELDS);
  if (lfb1Rows.length === 0) return [];
 
  // Step 2 — Build WHERE options for LFA1 (one OR per vendor number)
  const lifnrList = lfb1Rows.map(r => r.LIFNR);
  const lfa1Options = lifnrList.map((lifnr, i) => ({
    TEXT: (i === 0 ? `LIFNR EQ '${lifnr}'` : `OR LIFNR EQ '${lifnr}'`)
  }));
 
  const lfa1Res = await executeSapRfc(userTokenData, "RFC_READ_TABLE", {
    QUERY_TABLE: "LFA1",
    DELIMITER:   "~",
    FIELDS: [
      { FIELDNAME: "LIFNR" },
      { FIELDNAME: "NAME1" },   // Vendor Name
      { FIELDNAME: "ORT01" },   // City
      { FIELDNAME: "LAND1" },   // Country
      { FIELDNAME: "SPERR" }    // Central Block
    ],
    OPTIONS: lfa1Options
  });
 
  const lfa1Rows = parseRfcTable(lfa1Res.DATA, lfa1Res.FIELDS);
 
  // Step 3 — Build LFA1 lookup map
  const lfa1Map = {};
  lfa1Rows.forEach(r => { lfa1Map[r.LIFNR] = r; });
 
  // Step 4 — Join and optionally filter by name search
  let vendors = lfb1Rows
    .filter(r => lfa1Map[r.LIFNR])
    .map(r => {
      const g = lfa1Map[r.LIFNR];
      return {
        vendorNumber : r.LIFNR,
        name         : g.NAME1        || "",
        city         : g.ORT01        || "",
        country      : g.LAND1        || "",
        companyCode  : r.BUKRS,
        paymentTerms : r.ZTERM        || "",
        reconAccount : r.AKONT        || "",
        blocked      : g.SPERR === "X"
      };
    });
 
  if (search) {
    const q = search.toUpperCase();
    vendors = vendors.filter(v => v.name.toUpperCase().includes(q));
  }
 
  return vendors;
}
 
/* ===============================
   GET VENDORS ENDPOINT
================================= */
 
app.get("/api/sap/vendors", async (req, res) => {
  const companyCode = (req.query.companyCode || "1000").toString().padEnd(4, " ").substring(0,4);
  const search      = (req.query.search || "").trim();
 
  console.log(`\n→ Fetching vendors | Company Code: ${companyCode}${search ? ` | Search: ${search}` : ""}`);
 
  try {
    const vendors = await fetchVendorsByCompanyCode(req.user, companyCode, search);
 
    if (vendors.length === 0) {
      return res.json({ vendors: [], total: 0, message: `No vendors found for company code ${companyCode}` });
    }
 
    console.log(`← Found ${vendors.length} vendor(s)`);
    return res.json({ vendors, total: vendors.length, companyCode });
 
  } catch (err) {
    console.error("SAP VENDOR LIST error:", err.message);
    return res.status(500).json({ message: `SAP Error: ${err.message}` });
  }
});
 
/* ===============================
   SAP RFC EXECUTOR
================================= */
 
const ALLOWED_FUNCTIONS = [
  // MM
  'BAPI_PO_CREATE1', 'BAPI_PO_CHANGE', 'BAPI_PO_GETDETAIL1', 'BAPI_PR_CREATE', 'BAPI_PR_CHANGE', 'BAPI_REQUISITION_GETDETAIL', 
  'BAPI_GOODSMVT_CREATE', 'BAPI_GOODSMVT_GETDETAIL', 'BAPI_MATERIAL_GET_ALL', 'BAPI_MATERIAL_SAVEDATA', 'BAPI_VENDOR_GETDETAIL', 
  'BAPI_VENDOR_CREATE', 'BAPI_CONTRACT_CREATE', 'BAPI_CONTRACT_CHANGE', 'BAPI_CONTRACT_GETDETAIL', 'BAPI_SA_CREATE', 
  'BAPI_SA_CHANGE', 'BAPI_QUOTA_ARR_MAINTAIN', 'BAPI_INFOSOURCE_GETLIST', 'BAPI_INFORECORD_GETDETAIL', 'BAPI_INFORECORD_CREATE1',
  // SD
  'BAPI_SALESORDER_CREATEFROMDAT2', 'BAPI_SALESORDER_CHANGE', 'BAPI_SALESORDER_GETLIST', 'BAPI_SALESORDER_GETSTATUS', 
  'BAPI_DELIVERYPROCESSING_EXEC', 'BAPI_OUTB_DELIVERY_CHANGE', 'BAPI_OUTB_DELIVERY_GET_DET', 'BAPI_BILLINGDOC_CREATEMULTIPLE', 
  'BAPI_BILLINGDOC_GETDETAIL', 'BAPI_CUSTOMERRETURN_CREATE', 'BAPI_CREDITCHECK_GETDETAIL', 'BAPI_CUSTOMER_GETDETAIL2', 'BAPI_CUSTOMER_CREATEFROMDATA1',
  // PP
  'BAPI_PRODORD_CREATE', 'BAPI_PRODORD_CHANGE', 'BAPI_PRODORD_GET_DETAIL', 'BAPI_PRODORD_RELEASE', 'BAPI_PRODORDCONF_CREATE_HDR', 
  'BAPI_PRODORDCONF_GETDETAIL', 'BAPI_PLANNEDORDER_CREATE', 'BAPI_PLANNEDORDER_CHANGE', 'BAPI_PLANNEDORDER_GET_DET', 'BAPI_PROCORD_CREATE', 
  'BAPI_PROCORD_CHANGE', 'BAPI_PROCORD_GET_DETAIL', 'BAPI_BOM_HEADR_READ', 'BAPI_ROUTING_GET',
  // PM
  'BAPI_ALM_ORDER_MAINTAIN', 'BAPI_ALM_ORDER_GET_DETAIL', 'BAPI_ALM_NOTIF_CREATE', 'BAPI_ALM_NOTIF_DATA_MODIFY', 'BAPI_ALM_NOTIF_GET_DETAIL', 
  'BAPI_ALM_NOTIF_CLOSE', 'BAPI_EQUI_CREATE', 'BAPI_EQUI_CHANGE', 'BAPI_EQUI_GETDETAIL', 'BAPI_FUNCLOC_CREATE', 'BAPI_FUNCLOC_CHANGE', 
  'BAPI_FUNCLOC_GETDETAIL', 'BAPI_MEASPOINT_GETDETAIL', 'BAPI_MEAS_DOC_CREATE', 'BAPI_EQUI_GETLIST', 'EQUIPMENT_READ', 'BAPI_ALM_NOTIF_GETLIST', 'BAPI_ALM_ORDER_GET_LIST', 'BAPI_MPLAN_GETLIST',
  // FI
  'BAPI_ACC_DOCUMENT_POST', 'BAPI_ACC_DOCUMENT_REV_POST', 'BAPI_ACC_DOCUMENT_CHECK', 'BAPI_GL_ACC_GETDETAIL', 'BAPI_GL_ACC_GETPERIODBALANCES',
  'BAPI_AP_ACC_GETKEYDATEBAL', 'BAPI_AR_ACC_GETKEYDATEBAL', 'BAPI_AP_ACC_GETOPENITEMS', 'BAPI_AR_ACC_GETOPENITEMS', 'BAPI_INCOMINGINVOICE_CREATE', 
  'BAPI_INCOMINGINVOICE_CHANGE', 'BAPI_INCOMINGINVOICE_GETDET', 'BAPI_ACC_ACTIV_CHECK', 'BAPI_ASSET_ACQUISITION_POST', 'BAPI_ASSET_RETIREMENT_POST', 'BAPI_ASSET_GETDETAIL',
  // CO
  'BAPI_COSTCENTER_GETDETAIL', 'BAPI_COSTCENTER_CREATEMULTIPLE', 'BAPI_COSTCENTER_CHANGEMULTIPLE', 'BAPI_PROFITCENTER_GETDETAIL', 
  'BAPI_PROFITCENTER_CREATE', 'BAPI_PROFITCENTER_CHANGE', 'BAPI_INTERNALORDER_GETDETAIL', 'BAPI_INTERNALORDER_CREATE', 'BAPI_INTERNALORDER_CHANGE', 
  'BAPI_ACC_CO_DOCUMENT_POST', 'BAPI_ACC_ACTIVITY_ALLOC_POST', 'BAPI_ACC_ASSESS_POST',
  // QM
  'BAPI_INSPLOT_CREATE', 'BAPI_INSPLOT_GETDETAIL', 'BAPI_INSPLOT_CHANGE', 'BAPI_QUALNOT_CREATE', 'BAPI_QUALNOT_MODIFY', 
  'BAPI_QUALNOT_GETDETAIL', 'BAPI_QUALNOT_CLOSE', 'BAPI_INSPOPER_GETDETAIL', 'BAPI_INSPRESULT_RECORD', 'BAPI_CHARACT_GETDETAIL', 'BAPI_USAGE_DECISION_CREATE',
  // PS
  'BAPI_PROJECT_GETINFO', 'BAPI_PROJECT_MAINTAIN', 'BAPI_BUS2054_CREATE_MULTI', 'BAPI_BUS2054_CHANGE_MULTI', 'BAPI_BUS2054_GETDETAIL', 
  'BAPI_NETWORK_MAINTAIN', 'BAPI_NETWORK_GETDETAIL', 'BAPI_PS_ACTIV_MAINTAIN', 'BAPI_PS_MILESTONE_MAINTAIN',
  // WM
  'BAPI_WHSE_TO_CREATE_STOCK', 'BAPI_WHSE_TO_CREATE_PO', 'BAPI_WHSE_TO_GET_DETAIL', 'BAPI_WHSE_TO_CONFIRM', 'BAPI_WHSE_TR_CREATE', 
  'BAPI_WHSE_TR_GET_DETAIL', 'L_TO_CREATE_MULTIPLE', 'BAPI_WHSE_STOCK_GET_LIST',
  // HCM
  'BAPI_EMPLOYEE_GETDATA', 'BAPI_EMPLOYEE_ENQUEUE', 'BAPI_EMPLOYEE_DEQUEUE', 'BAPI_PERSDATA_GETDETAIL', 'BAPI_ORGUNIT_GETDETAIL', 
  'BAPI_ABSENCE_CREATE', 'BAPI_ABSENCE_GETDETAIL', 'BAPI_ATTENDANCE_CREATE', 'BAPI_TIMESHEET_CREATESUCC', 'BAPI_PAYSLIP_GETDETAIL', 'BAPI_TRIP_CREATE_FROM_DATA',
  // BASIS / Cross-Module
  'RFC_READ_TABLE', 'BAPI_TRANSACTION_COMMIT', 'BAPI_TRANSACTION_ROLLBACK', 'BAPI_USER_GET_DETAIL', 'BAPI_USER_CHANGE', 
  'BAPI_USER_CREATE1', 'BAPI_USER_LOCK', 'BAPI_USER_UNLOCK', 'BAPI_HELPVALUES_GET', 'BAPI_DOCUMENT_CREATE2', 'BAPI_DOCUMENT_GETDETAIL2', 'BAPI_MESSAGE_GETDETAIL'
];

async function executeSapRfc(userTokenData, functionName, params, autoCommit = false) {
  if (!ALLOWED_FUNCTIONS.includes(functionName)) {
    throw new Error(`Security restriction: BAPI '${functionName}' is not permitted.`);
  }

  // Map system description back to system key
  const systemKey = Object.keys(SAP_SYSTEM_CONFIGS).find(
    k => SAP_SYSTEM_CONFIGS[k].description === userTokenData.system
  ) || userTokenData.system || "PRD";
 
  const sysConfig = SAP_SYSTEM_CONFIGS[systemKey];
  if (!sysConfig) throw new Error(`Unknown SAP system: ${userTokenData.system}`);
 
  const connParams = {
    ashost: sysConfig.ashost,
    sysnr: sysConfig.sysnr,
    client: userTokenData.client || sysConfig.client,
    user: userTokenData.userId,
    passwd: process.env.SERVICE_PASSWORD,
    lang: "EN"
  };
 
  console.log(`\n→ RFC Call: ${functionName}`);
  console.log("  Params:", JSON.stringify(params, null, 2));
 
  const rfcClient = new Client(connParams);
  try {
    await rfcClient.open();
    const result = await rfcClient.call(functionName, params);
    console.log(`← RFC Result keys: ${Object.keys(result).join(", ")}`);
   
    if (autoCommit) {
      const returnMsgs = result.RETURN || [];
      const errors = Array.isArray(returnMsgs)
        ? returnMsgs.filter(r => r.TYPE === 'E' || r.TYPE === 'A')
        : (returnMsgs.TYPE === 'E' || returnMsgs.TYPE === 'A' ? [returnMsgs] : []);
       
      if (errors.length === 0) {
        console.log(`→ Executing BAPI_TRANSACTION_COMMIT in the same SAP session...`);
        await rfcClient.call("BAPI_TRANSACTION_COMMIT", { WAIT: "X" });
        console.log(`✅ Transaction committed successfully.`);
      } else {
        console.log(`⚠️ Auto-commit aborted due to BAPI errors in result. Executing ROLLBACK...`);
        await rfcClient.call("BAPI_TRANSACTION_ROLLBACK", {});
      }
    }
   
    return result;
  } catch (err) {
    if (autoCommit && rfcClient.alive) {
      console.log(`⚠️ Execution failed. Executing ROLLBACK...`);
      await rfcClient.call("BAPI_TRANSACTION_ROLLBACK", {});
    }
    throw err;
  } finally {
    try {
      if (rfcClient.alive) {
        await rfcClient.close();
      }
    } catch (closeErr) {
      console.error(`⚠️ Non-fatal error closing RFC client: ${closeErr.message}`);
    }
  }
}

 
/* ===============================
   PASS 1: OpenAI generates SAP call
   (User message → RFC call JSON)
================================= */
 
// ── Store last executed query per user session for follow-up context ──
const lastQueryByUser = {};
 
async function aiGenerateSapCall(conversationHistory, latestMessage, lastQuery) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("YOUR_")) {
    throw new Error("OPENAI_API_KEY not configured in .env");
  }
 
  const messages = [{ role: "system", content: SAP_PASS1_PROMPT }];
 
  // Include last 6 turns of history — with smart summarization for assistant replies
  const recentHistory = conversationHistory.slice(-6);
  for (const turn of recentHistory) {
    const role = turn.role === "assistant" ? "assistant" : "user";
    let content = (turn.content || "").trim();
 
    if (role === "assistant" && content.length > 300) {
      // Extract key metadata from the response instead of raw-truncating
      // Look for table/record info like "✅ LFB1 + LFA1: 42 record(s)"
      const tableMatch = content.match(/✅\s*([\w\s+]+):\s*(\d+)\s*record/);
      const headerMatch = content.match(/\|([^|]+(?:\|[^|]+)+)\|/); // First table header row
 
      if (tableMatch) {
        const tables = tableMatch[1].trim();
        const count = tableMatch[2];
        // Extract column headers if present
        let fields = '';
        if (headerMatch) {
          fields = headerMatch[1].split('|').map(f => f.trim()).filter(f => f && !f.includes('---')).join(', ');
        }
        content = `[PREVIOUS RESULT: ${tables}, ${count} records. Columns: ${fields || 'various'}. This was a tabular result shown to the user.]`;
      } else {
        // For non-table responses (PO details, single values), keep more context
        content = content.substring(0, 600) + "... [truncated]";
      }
    }
 
    if (content) messages.push({ role, content });
  }
 
  // Inject the PREVIOUS QUERY context so AIknows exactly what was executed
  if (lastQuery && lastQuery.length > 0) {
    const queryDesc = lastQuery.map(c => {
      const tbl = c.params?.QUERY_TABLE || c.params?.PURCHASEORDER || c.function;
      const fields = (c.params?.FIELDS || []).map(f => f.FIELDNAME).join(', ');
      const where = (c.params?.OPTIONS || []).map(o => o.TEXT).join(' ');
      return `${c.function}(${tbl}) — fields: [${fields}] — where: ${where || 'none'}`;
    }).join('\n');
    messages.push({ role: "system", content: `CONTEXT — The PREVIOUS SAP query that was executed for this user:\n${queryDesc}\n\nIf the user wants to MODIFY or ADD to these results, build a NEW query that includes the same tables/filters PLUS the additional tables needed. Do NOT re-read old data — write a fresh complete query.` });
  }
 
  // Append latest message
  const last = recentHistory[recentHistory.length - 1];
  if (!last || last.role !== "user" || last.content !== latestMessage) {
    messages.push({ role: "user", content: latestMessage });
  }
 
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    // Pass 1 uses gpt-4o (full model) for maximum accuracy in SAP call generation
    // This is where reasoning matters most — wrong table/field = SAP error
    { model: "gpt-4.1", response_format: { type: "json_object" }, messages },
    { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 60000 }
  );
 
  const raw = response.data.choices[0].message.content;
  console.log("\n[Pass 1 — AI Generated Call]", raw);
  return JSON.parse(raw);
}
 
/* ===============================
   PASS 2: OpenAI formats SAP result
   (Raw SAP data → Human answer)
================================= */
 
async function aiFormatResult(userMessage, sapCallInfo, sapResult) {
  const apiKey = process.env.OPENAI_API_KEY;
 
  // ── For large table results, build the table server-side ──────────
  // This avoids token overflow and ensures ALL rows are shown
  const resultEntries = Object.entries(sapResult);
  const tableEntry = resultEntries.find(([k, v]) => v && v.rows && v.rows.length > 15);
 
  if (tableEntry) {
    const [, data] = tableEntry;
    // Build table server-side — just ask AI for a short title
    const LABELS = {
      LIFNR: 'Vendor No.', NAME1: 'Name', NAME2: 'Name 2', ORT01: 'City', LAND1: 'Country',
      BUKRS: 'Co. Code', AKONT: 'Recon Acct', ZTERM: 'Pay Terms', ZWELS: 'Pay Method',
      SPERR: 'Blocked', LOEVM: 'Deleted', EBELN: 'PO No.', EBELP: 'Item', MATNR: 'Material',
      MENGE: 'Qty', MEINS: 'Unit', NETPR: 'Net Price', NETWR: 'Net Value', WERKS: 'Plant',
      MAKTX: 'Description', STRAS: 'Street', PSTLZ: 'Postal Code', TELF1: 'Phone',
      BSART: 'Doc Type', EKORG: 'Purch Org', EKGRP: 'Purch Grp', WAERS: 'Currency',
      BEDAT: 'Doc Date', AEDAT: 'Changed', ERNAM: 'Created By', ADRNR: 'Address'
    };
 
    // Skip columns that are entirely empty
    const activeFields = data.fields.filter(f =>
      data.rows.some(row => row[f] && row[f].trim())
    );
 
    let table = `✅ ${data.table}: ${data.rowCount} record(s)\n\n`;
    // Header
    table += '| ' + activeFields.map(f => LABELS[f] || f).join(' | ') + ' |\n';
    table += '|' + activeFields.map(() => '---').join('|') + '|\n';
    // Rows — keep values as-is (including leading zeros per user request)
    data.rows.forEach(row => {
      table += '| ' + activeFields.map(f => (row[f] || '').trim() || '—').join(' | ') + ' |\n';
    });
 
    return table;
  }
 
  // ── For smaller results / BAPI data, let AI format ────────────────
  const resultStr = JSON.stringify(sapResult).substring(0, 30000);
 
  const messages = [
    { role: "system", content: SAP_PASS2_PROMPT },
    { role: "user", content: `User asked: "${userMessage}"\n\nSAP Function called: ${sapCallInfo}\n\nSAP Result:\n${resultStr}` }
  ];
 
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    { model: "gpt-4.1-mini", messages },
    { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 60000 }
  );
 
  return response.data.choices[0].message.content;
}
 
/* ===============================
   CHAT ENDPOINT — 2-Pass AI Proxy
================================= */
 
app.post("/api/chat" , async (req, res) => {
  try {
    const message = (req.body.message || req.body.prompt || "").trim();
    if (!message) {
      return res.status(400).json({ message: "A non-empty message is required." });
    }
 
    const history = Array.isArray(req.body.history) ? req.body.history : [];
    const userId = req.user.userId;
 
    console.log(`\n=== CHAT [${req.user.userId}] ===`);
    console.log("Message  :", message);
    console.log("History  :", history.length, "turns");
 
    // ═══════════════════════════════════════
    //  PASS 1: AI decides what SAP call to make
    // ═══════════════════════════════════════
    let aiCall;
    try {
      aiCall = await aiGenerateSapCall(history, message, lastQueryByUser[userId]);
    } catch (aiErr) {
      console.error("Pass 1 error:", aiErr.message);
      return res.status(503).json({ reply: `AI service error: ${aiErr.message}` });
    }
 
    // Handle error responses from AI
    if (aiCall.error) {
      return res.json({ reply: `❌ ${aiCall.error}` });
    }
 
    // Handle greeting / conversational / follow-up from history
    if (aiCall.function === "NONE") {
      const reply = aiCall.reply || "How can I help you with SAP today?";
      // Detect PO creation intent — trigger form in frontend
      const isPoCreation = reply.toLowerCase().includes('purchase order') &&
        (reply.toLowerCase().includes('create') || reply.toLowerCase().includes('provide'));
      return res.json({ reply, poForm: isPoCreation || false });
    }
 
    // ═══════════════════════════════════════
    //  EXECUTE: Run the SAP call(s)
    // ═══════════════════════════════════════
 
    // Normalize to array — AI may return:
    //   { function: "X", params: {...} }                    → single call
    //   { calls: [{ function: "X" }, { function: "Y" }] }  → array wrapped in object (json_object mode)
    //   [{ function: "X" }, { function: "Y" }]              → raw array (rarely)
    let calls;
    if (Array.isArray(aiCall)) {
      calls = aiCall;
    } else if (Array.isArray(aiCall.calls)) {
      calls = aiCall.calls;
    } else if (aiCall.function) {
      calls = [aiCall];
    } else {
      // Try to find any array property that contains function calls
      const arrayProp = Object.values(aiCall).find(v => Array.isArray(v) && v.length > 0 && v[0].function);
      calls = arrayProp || [aiCall];
    }
 
    const allResults = {};
 
    // Save this query so the NEXT message has context for follow-ups
    lastQueryByUser[userId] = calls;
 
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const funcName = call.function;
      const params = call.params || {};
 
      // ── Safety net: Auto-inject FIELDS if AI forgot them (prevents SAP error 559) ──
      if (funcName === "RFC_READ_TABLE") {
        if (!params.FIELDS || params.FIELDS.length === 0) {
          const SAFE_FIELDS = {
            LFA1: ['LIFNR','NAME1','NAME2','ORT01','LAND1','STRAS','PSTLZ','REGIO','TELF1'],
            LFB1: ['LIFNR','BUKRS','AKONT','ZTERM','ZWELS','SPERR','LOEVM'],
            EKKO: ['EBELN','BUKRS','BSART','LIFNR','EKORG','EKGRP','WAERS','BEDAT','ERNAM','RLWRT'],
            EKPO: ['EBELN','EBELP','MATNR','TXZ01','MENGE','MEINS','NETPR','NETWR','WERKS'],
            MARA: ['MATNR','MTART','MAKTX','MEINS','MATKL','LABOR','SPART'],
            MAKT: ['MATNR','SPRAS','MAKTX'],
            MARD: ['MATNR','WERKS','LGORT','LABST','INSME','SPEME','RETME','UMLME'],
            MARC: ['MATNR','WERKS','DISMM','MINBE','MABST','EISBE','BESKZ','SOBSL','DZEIT','PLIFZ'],
            MBEW: ['MATNR','BWKEY','STPRS','VERPR','LBKUM','SALK3','VPRSV'],
            MVER: ['MATNR','WERKS','GJAHR','PERNR','MGV01','MGV02','MGV03'],
            KNA1: ['KUNNR','NAME1','NAME2','ORT01','LAND1','STRAS','PSTLZ'],
            KNB1: ['KUNNR','BUKRS','AKONT','ZTERM','SPERR'],
            T001: ['BUKRS','BUTXT','ORT01','LAND1','WAERS'],
            BKPF: ['BUKRS','BELNR','GJAHR','BLART','BUDAT','BLDAT','WAERS','USNAM'],
            BSEG: ['BUKRS','BELNR','GJAHR','BUZEI','KOART','SHKZG','DMBTR','WRBTR'],
            CSKS: ['KOSTL','DATBI','DATAB','BUKRS','KOSAR','KTEXT'],
            AUFK: ['AUFNR','AUTYP','AUART','BUKRS','WERKS','ERNAM','ERDAT','LOEKZ','KTEXT','EQUNR','TPLNR','KOSTL','ILOAN','IPHAS'],
            AFKO: ['AUFNR','PLNBEZ','GAMNG','GMEIN','GLTRS','GSTRP','FTRMS','DTEFN','RSNUM'],
            AFPO: ['AUFNR','POSNR','MATNR','PSMNG','WEMNG','MEINS','WERKS'],
            AFRU: ['AUFNR','RUECK','ISMNW','ISMNE','ISMNU','ARBID','PERNR','BUDAT','LTXA1'],
            EQUI: ['EQUNR','EQTYP','EQART','INBDT','MATNR','SERNR','WERK','HERST','TYPBZ','SERGE'],
            EQKT: ['EQUNR','SPRAS','EQKTX'],
            EQUZ: ['EQUNR','DATBI','ILOAN','HEQUI'],
            EQST: ['EQUNR','BEGDA','ENDDA','STSMA','ESTAT'],
            JEST: ['OBJNR','STAT','INACT','CHGNR'],
            ILOA: ['ILOAN','TPLNR','ABCKZ','BUKRS','KOKRS','KOSTL','SWERK','STORT','GEWRK'],
            IFLOT: ['TPLNR','PLTXT','FLTYP','ERDAT','IWERK','STORT'],
            RESB: ['RSNUM','RSPOS','MATNR','BDMNG','MEINS','WERKS','LGORT','AUFNR','ENMNG','XWAOK'],
            COBK: ['KOKRS','BELNR','BUDAT','BLDAT','VRGNG','AWTYP','GJAHR','BLTXT'],
            COEP: ['KOKRS','BELNR','BUZEI','OBJNR','KSTAR','WTG001','MEGBTR','MEINH','WKGBTR','GJAHR','PERNR'],
            COSS: ['OBJNR','GJAHR','WRTTP','KSTAR','WKG001'],
            COSP: ['OBJNR','GJAHR','WRTTP','KSTAR','WKG001'],
            CRHD: ['OBJID','ARBPL','WERKS','VERWE','KTEXT'],
            QMEL: ['QMNUM','QMART','QMTXT','ERDAT','ERNAM','EQUNR','TPLNR','PRIOK','AUSVN','AUSBS','AUZEL','QMGRP','QMCOD'],
            VIQMEL: ['QMNUM','QMART','QMTXT','ERDAT','ERNAM','EQUNR','TPLNR','PRIOK','AUSVN','AUSBS','AUZEL','QMGRP','QMCOD'],
            QMFE: ['QMNUM','FENUM','FEGRP','FECOD','FETXT','OTGRP','OTEIL'],
            QMUR: ['QMNUM','FENUM','URNUM','URGRP','URCOD','URTXT'],
            QALS: ['PRUEFLOS','MATNR','WERK','LOSNR','STAT','AUFNR'],
            QAVE: ['PRUEFLOS','VCODE','VETYPE'],
            VBAK: ['VBELN','AUDAT','AUART','VKORG','KUNNR','NETWR','WAERS','ERNAM'],
            VBAP: ['VBELN','POSNR','MATNR','ARKTX','KWMENG','NETWR','WERKS'],
            VBEP: ['VBELN','POSNR','ETENR','EDATU','WMENG'],
            LIKP: ['VBELN','LFART','WADAT','KUNNR','ERNAM','ERDAT'],
            LIPS: ['VBELN','POSNR','MATNR','ARKTX','LFIMG','MEINS','WERKS'],
            VBRK: ['VBELN','FKART','FKDAT','KUNAG','NETWR','WAERK','BUKRS'],
            VBRP: ['VBELN','POSNR','MATNR','ARKTX','FKIMG','NETWR','AUBEL'],
            PROJ: ['PSPNR','PSPID','POST1','VERNR','VBUKR','ERNAM'],
            PRPS: ['PSPNR','POSID','POST1','OBJNR','PSPHI','STUFE'],
            AFIH: ['AUFNR','ILOAN','EQUNR','TPLNR','IWERK','QMNUM','PRIOK','ILATX','ILART','GEWRK','INGPR'],
            MKPF: ['MBLNR','MJAHR','BUDAT','USNAM','VGART'],
            MSEG: ['MBLNR','MJAHR','ZEILE','BWART','MATNR','WERKS','MENGE','MEINS','AUFNR','EBELN','LGORT','KOSTL','BUDAT_MKPF'],
            RBKP: ['BELNR','GJAHR','BUKRS','LIFNR','WAERS','RMWWR','CPUDT'],
            RSEG: ['BELNR','GJAHR','BUZEI','EBELN','EBELP','MATNR','WRBTR'],
            LQUA: ['LGNUM','LGTYP','LGPLA','MATNR','WERKS','GESME','MEINS'],
            LTAP: ['LGNUM','TANUM','MATNR','WERKS','VSOLA','MEINS'],
            MPLA: ['WARPL','AENAM','STRAT','WAPOS','WPGRP'],
            MPOS: ['WARPL','WAPOS','EQUNR','TPLNR','QMART','ILART','GEWRK'],
            MHIS: ['WARPL','ABNUM','TERMN','TSTAT','AUFNR','ABRMV'],
            EINA: ['INFNR','MATNR','LIFNR','NETPR','WAERS','APLFZ'],
            EINE: ['INFNR','MATNR','LIFNR','NETPR','WAERS','APLFZ']
          };
          const tbl = params.QUERY_TABLE;
          if (SAFE_FIELDS[tbl]) {
            params.FIELDS = SAFE_FIELDS[tbl].map(f => ({ FIELDNAME: f }));
            console.log(`  ⚠️ Auto-injected FIELDS for ${tbl} (AI forgot to specify)`);
          }
        }
        // Ensure robust structure for node-rfc
        if (params.FIELDS) {
          if (typeof params.FIELDS === 'string') {
            params.FIELDS = params.FIELDS.split(',').map(s => ({ FIELDNAME: s.trim() }));
          } else if (Array.isArray(params.FIELDS)) {
            params.FIELDS = params.FIELDS.map(f => typeof f === 'string' ? { FIELDNAME: f } : f);
          } else if (typeof params.FIELDS === 'object') {
            params.FIELDS = [params.FIELDS];
          }
        }
        if (params.OPTIONS) {
          if (typeof params.OPTIONS === 'string') {
            params.OPTIONS = [{ TEXT: params.OPTIONS }];
          } else if (Array.isArray(params.OPTIONS)) {
            params.OPTIONS = params.OPTIONS.map(o => typeof o === 'string' ? { TEXT: o } : o);
          } else if (typeof params.OPTIONS === 'object') {
            params.OPTIONS = [params.OPTIONS];
          }
        }
        if (params.DATA && !Array.isArray(params.DATA)) {
          if (typeof params.DATA === 'object') {
            params.DATA = [params.DATA];
          } else {
            delete params.DATA;
          }
        }
        // Clean out unsupported parameters invented by AI
        delete params.ORDER_BY;
        delete params.OPTIONS_TEXT;
        delete params.GROUP_BY;

        // Force delimiter
        if (!params.DELIMITER) params.DELIMITER = "|";
      }
 
      console.log(`→ SAP Call ${i + 1}: ${funcName}`);
      console.log("  Params:", JSON.stringify(params).substring(0, 300));
 
      try {
        const isBapiUpdate = funcName.startsWith("BAPI_") && funcName.includes("CREATE");
        const result = await executeSapRfc(req.user, funcName, params, isBapiUpdate);
 
        // For BAPI_PO_CREATE1, handle result
        if (funcName === "BAPI_PO_CREATE1") {
          console.log("BAPI_PO_CREATE1 result keys:", Object.keys(result).join(', '));
         
          // SAP returns PO number in EXPPURCHASEORDER (not PURCHASEORDER)
          const poNum = (result.EXPPURCHASEORDER || result.PURCHASEORDER || "").trim();
          const returnMsgs = result.RETURN || [];
          const errors = returnMsgs.filter(r => r.TYPE === 'E' || r.TYPE === 'A');
          const successMsgs = returnMsgs.filter(r => r.TYPE === 'S');
          const warnings = returnMsgs.filter(r => r.TYPE === 'W' || r.TYPE === 'I');
         
          // Success: PO number exists and no hard errors (warnings are OK)
          if (poNum && poNum !== '0000000000' && errors.length === 0) {
            console.log(`✅ Transaction committed. PO: ${poNum}`);
            let successMsg = `✅ **Purchase Order Created Successfully!**\n\n- **New PO Number**: ${poNum}\n- **Vendor**: ${params.POHEADER?.VENDOR || '—'}\n- **Company Code**: ${params.POHEADER?.COMP_CODE || '—'}\n- **Material**: ${params.POITEM?.[0]?.MATERIAL || '—'}\n- **Quantity**: ${params.POITEM?.[0]?.QUANTITY || '—'}\n- **Plant**: ${params.POITEM?.[0]?.PLANT || '—'}\n- **Delivery Date**: ${params.POSCHEDULE?.[0]?.DELIVERY_DATE || '—'}\n\nYou can now use this PO number to check details: "Show PO ${poNum}"`;
            // Append warnings if any
            if (warnings.length > 0) {
              successMsg += `\n\n⚠️ **Warnings**: ${warnings.map(w => w.MESSAGE).join(', ')}`;
            }
            return res.json({ reply: successMsg });
          } else {
            console.log("PO Creation failed. Errors:", errors.map(r => r.MESSAGE).join('; '));
            const errorDetails = errors.map(r => r.MESSAGE).join('\n') || 'No error details returned from SAP.';
            return res.json({ reply: `⚠️ **PO Creation Failed**\n\n${errorDetails}\n\nPlease check the details and try again.` });
          }
        }
 
        // ── Pre-process RFC_READ_TABLE data ──────────────────────────
        // Convert pipe-delimited rows into clean JSON so Pass 2 can
        // work with structured data instead of raw strings
        if (funcName === "RFC_READ_TABLE" && result.DATA && result.FIELDS) {
          const fields = result.FIELDS.map(f => f.FIELDNAME);
          const rows = result.DATA.map(row => {
            const values = row.WA.split("|");
            const obj = {};
            fields.forEach((f, idx) => {
              obj[f] = (values[idx] || "").trim();
            });
            return obj;
          });
          allResults[`${funcName}_${i}`] = {
            table: params.QUERY_TABLE,
            fields: fields,
            rowCount: rows.length,
            rows: rows
          };
          console.log(`  ✅ ${params.QUERY_TABLE}: ${rows.length} rows, fields: ${fields.join(', ')}`);
        } else {
          allResults[`${funcName}_${i}`] = result;
        }
 
      } catch (sapErr) {
        console.error(`SAP Error (${funcName}):`, sapErr.message);
        allResults[`${funcName}_${i}_ERROR`] = sapErr.message;
      }
    }
 
    // ═══════════════════════════════════════
    //  MERGE ENGINE: Progressive N-table join
    // ═══════════════════════════════════════
    // Supports 2, 3, or more RFC_READ_TABLE results.
    // Handles one-to-many (1 vendor → many POs) by expanding rows.
    const COMMON_KEYS = [
      "LIFNR","MATNR","EBELN","BUKRS","KUNNR","AUFNR","EQUNR",
      "QMNUM","TPLNR","VBELN","BANFN","BELNR","MBLNR","PSPNR",
      "POSID","KOSTL","LGNUM","PERNR","ILOAN","RSNUM","PRUEFLOS",
      "OBJNR","TBNUM","WARPL"
    ];
    let rfcResults = Object.entries(allResults).filter(([k, v]) => v && v.rows);
 
    while (rfcResults.length > 1) {
      const [key1, table1] = rfcResults[0];
      const [key2, table2] = rfcResults[1];
      const commonKey = COMMON_KEYS.find(k => table1.fields.includes(k) && table2.fields.includes(k));
 
      if (!commonKey) {
        console.log(`[Merge] No common key between ${table1.table} and ${table2.table}, skipping`);
        break;
      }
 
      console.log(`[Merge] Joining ${table1.table} + ${table2.table} on ${commonKey}`);
 
      // Build lookup from table2 — support one-to-many (multiple rows per key)
      const lookup = {};
      table2.rows.forEach(row => {
        const keyVal = row[commonKey];
        if (!lookup[keyVal]) lookup[keyVal] = [];
        lookup[keyVal].push(row);
      });
 
      const newFields = table2.fields.filter(f => !table1.fields.includes(f));
      const mergedRows = [];
 
      table1.rows.forEach(row => {
        const matches = lookup[row[commonKey]];
        if (matches && matches.length > 0) {
          // One-to-many: create a row for each match
          matches.forEach(match => {
            const merged = { ...row };
            newFields.forEach(f => { merged[f] = match[f] || ''; });
            mergedRows.push(merged);
          });
        } else {
          // No match: keep original row with blanks for new fields
          const merged = { ...row };
          newFields.forEach(f => { merged[f] = ''; });
          mergedRows.push(merged);
        }
      });
 
      // Replace table1 with merged result, remove table2
      allResults[key1] = {
        table: `${table1.table} + ${table2.table}`,
        fields: [...table1.fields, ...newFields],
        rowCount: mergedRows.length,
        rows: mergedRows
      };
      delete allResults[key2];
      console.log(`  ✅ Merged: ${mergedRows.length} rows, ${allResults[key1].fields.length} fields`);
 
      // Re-scan for remaining RFC results to merge next
      rfcResults = Object.entries(allResults).filter(([k, v]) => v && v.rows);
    }
 
    // ═══════════════════════════════════════
    //  PASS 2: AI formats the result
    // ═══════════════════════════════════════
    const callInfo = calls.map(c => `${c.function}(${(c.params?.QUERY_TABLE || c.params?.PURCHASEORDER || '')})`).join(" + ");
    console.log(`[Pass 2] Sending to AI: ${callInfo}, data size: ${JSON.stringify(allResults).length} chars`);
 
    let formattedReply;
    try {
      formattedReply = await aiFormatResult(message, callInfo, allResults);
    } catch (aiErr) {
      console.error("Pass 2 error:", aiErr.message);
      // Fallback: Build a proper markdown table from pre-processed data
      const parts = [];
      for (const [key, val] of Object.entries(allResults)) {
        if (typeof val === 'string') {
          parts.push(`❌ Error: ${val}`);
        } else if (val.rows && val.rows.length > 0) {
          parts.push(`✅ ${val.table}: ${val.rowCount} record(s)\n`);
          // Build markdown table header
          const fields = val.fields;
          parts.push('| ' + fields.join(' | ') + ' |');
          parts.push('|' + fields.map(() => '---').join('|') + '|');
          // Data rows (max 50)
          val.rows.slice(0, 50).forEach(row => {
            parts.push('| ' + fields.map(f => (row[f] || '').trim() || '—').join(' | ') + ' |');
          });
          if (val.rowCount > 50) parts.push(`\n... and ${val.rowCount - 50} more records`);
        } else if (val.POHEADER) {
          parts.push(`PO data received but formatting failed. Please try again.`);
        }
      }
      formattedReply = parts.join('\n') || 'SAP returned data but formatting failed.';
    }
 
    console.log("[Pass 2 — Formatted Reply]", formattedReply.substring(0, 200));
 
    return res.json({ reply: formattedReply });
 
  } catch (err) {
    console.error("CHAT ENDPOINT ERROR:", err.message);
    return res.status(500).json({ message: err.message });
  }
});
 
 
/* ===============================
   START SERVER
================================= */
 
app.listen(PORT, () => {
  console.log("=========================================");
  console.log("🚀 SAP Conversational Middleware v3.1");
  console.log(`📡 Port: ${PORT}`);
  console.log(`🕒 Started: ${new Date().toLocaleString()}`);
  console.log("=========================================");
 
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("YOUR_")) {
    console.warn("⚠️  OPENAI_API_KEY not set — chat will fail.");
  } else {
    console.log(`✅ OpenAI: key loaded (${apiKey.substring(0, 8)}...)`);
  }
 
  if (!process.env.SERVICE_PASSWORD) {
    console.warn("⚠️  SERVICE_PASSWORD not set — SAP BAPI calls will fail.");
  } else {
    console.log("✅ SAP service password: loaded");
  }
});