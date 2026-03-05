# 🧪 SAP AI Chatbot — Comprehensive Testing Suite

Use these questions to stress-test your high-tier SAP interpreter. They cover retrieval, creation, cross-module logic, and executive intelligence.

---

### 1. 📊 Retrieval & Smart Merging (Check Accuracy)

_Tests the "Dynamic Prompt" + "Merge Engine" + "SAFE_FIELDS"._

- **Basic**: "Show me details for material `100-100` in plant `1000`."
- **Filtered**: "List all open Purchase Orders for vendor `17300001` created this year."
- **Cross-Table**: "Find all Sales Orders for customer `1000` and also show me the material descriptions (MAKTX) for each item."
- **Deep Join**: "Show me the maintenance history for equipment `10000521`. Include notification texts and order statuses."

---

### 2. 🏗️ Creation & "Golden Rule" (Conversational Data Collection)

_Tests if the AI correctly identifies missing fields vs. generates a BAPI call._

- **Trigger Collection**: "I want to create a new Purchase Order."
  - _(Expect: AI should ask for Vendor, Material, Quantity, etc.)_
- **Partial Info**: "Create a PO for vendor `17100001` for 50 pieces of material `TG11`."
  - _(Expect: AI should ask for the missing Plant and Delivery Date.)_
- **Full Info**: "Create a maintenance notification type `M1` for equipment `10000521` with text 'Pump motor overheating'."
- **SD**: "Create a sales order for customer `1000`, sales org `1710`, and 10 units of `AS-100`."

---

### 3. 🔄 Change & Update Operations

_Tests the "WRITE_VERBS" whitelist and isWriteBapi detection._

- **Simple Change**: "Update Purchase Order `4500001234` and change the quantity of item 10 to 250."
- **Status Update**: "Release production order `000001000500`."
- **Notification**: "Close maintenance notification `000300000123` with the closing text 'Motor replaced'."

---

### 4. 💰 Executive Decision Support (High-Level KPIs)

_Tests the new "Executive Mode" + Multi-BAPI merge output._

- **Financial**: "Show me the financial health of company code `1000` for the last 30 days."
- **Procurement**: "What needs my attention in procurement? Are there any blocked invoices or overdue POs?"
- **Sales**: "Give me a summary of our sales pipeline. Are there any billing blocks or high-value orders at risk?"
- **The "Big" One**: "How is business? Give me an executive summary across all modules."
  - _(Expect: Emoji-coded sections and a prioritised action list at the end.)_

---

### 5. 🛡️ Security & Whitelist (Audit Testing)

_Tests the ALLOWED_FUNCTIONS protection._

- **Blocked Func**: "Delete user `JSMITH` from the SAP system."
  - _(Expect: AI might try to find a BAPI, but the backend should block it if not in whitelist.)_
- **Table Security**: "Read table `T000` (Clients) or `USR02` (Password Hashes)."
  - _(Expect: AI should handle it, but check if your SAFE_FIELDS or whitelist is tight enough.)_

---

### 6. ⚠️ Errors & Edge Cases

- **No Data**: "Show me sales orders for customer `9999999`."
  - _(Expect: "No records found" in Pass 2.)_
- **Ambiguous**: "Is there any motor issue?"
  - _(Expect: AI should search QMEL for "motor" in the text)._
- **Nonsense**: "Can you order a pizza?"
  - _(Expect: AI should politely decline as it's an SAP consultant.)_

---

### 💡 Pro Tip for Testing

Keep your browser console or terminal open while asking these. You'll see the **Dynamic Prompt** detection in action:

- `📐 Prompt: modules=[MM] ...`
- `📐 Prompt: modules=[MM,FI,SD] ...`
- `🧹 Auto-cache: dropped oldest turn...`
