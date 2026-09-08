# Applywizz Pantry - Complete Product Requirements Document (PRD)
## Comprehensive Line-by-Line Analysis & System Documentation

**Version:** 2.0  
**Last Updated:** May 15, 2026  
**Repository:** https://github.com/GOODBOYKITTU272/Inventory  
**Total Codebase:** ~65 source files, ~5,200+ lines of code  
**Live URLs:**
- Frontend: https://inventory-ashen-theta.vercel.app
- Backend: https://inventory-vgor.onrender.com

---

## 1. EXECUTIVE SUMMARY

### 1.1 Project Overview
Applywizz Pantry is a **comprehensive office facility management system** that combines:
- **Inventory Management** - Track 34+ pantry items with real-time stock updates
- **AI-Powered Requests** - Employee service requests with GPT-4o-mini natural language processing
- **Bill OCR Automation** - Automated bill processing via OpenAI Vision (GPT-4o)
- **Self-Learning AI Brain** - Personalized employee preferences that learn from behavior
- **Multi-Channel Integration** - Microsoft Teams, Telegram, WhatsApp bill submission

### 1.2 Key Metrics
- **Users:** 5 roles (Leadership, Facility Manager, Finance, Office Boy, Staff)
- **Database:** ~25 tables with full Row Level Security (RLS)
- **AI Models:** GPT-4o-mini (text), GPT-4o (vision/PDF), Custom learning algorithms
- **Integrations:** Microsoft Teams, Telegram Bot, Make.com/Zapier webhooks
- **Deployments:** Vercel (frontend), Render (backend), Supabase (database)

---

## 2. SYSTEM ARCHITECTURE

### 2.1 Technology Stack

| Component | Technology | Version | Files |
|-----------|-----------|---------|-------|
| **Frontend** | React + Vite + Tailwind CSS | React 18.3.1 | 14 pages, 70+ components |
| **Backend** | Node.js + Express | Node 18+ | 10 route files, 5 middleware |
| **Database** | Supabase PostgreSQL | 15+ | 8 migrations, 25 tables |
| **Authentication** | Supabase Auth (Microsoft OAuth) | 2.45.0 | Domain-gated to @applywizz.ai |
| **AI/ML** | OpenAI API | GPT-4o, GPT-4o-mini | openai.js, learning.js, recommendations.js |
| **File Storage** | Supabase Storage | - | bills/ bucket for PDFs/images |
| **Testing** | Playwright E2E | 1.47.0 | 8 test scenarios |
| **CI/CD** | Vercel + Render | - | Auto-deploy on git push |

### 2.2 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      USERS (Browser)                         │
──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   Vercel (Frontend)          │
        │   inventory-ashen-theta      │
        │   .vercel.app                │
        └──────────┬───────────────────┘
                   │ API Calls
                   ▼
        ┌──────────────────────────────┐
        │   Render (Backend API)       │
        │   inventory-vgor.onrender.com│
        │   Port: 10000                │
        └──────────┬───────────────────┘
                   │
                   ▼
        ┌──────────────────────────────┐
        │   Supabase (Database)        │
        │   - PostgreSQL               │
        │   - Auth (Microsoft OAuth)   │
        │   - Storage (bills/)         │
        │   - Edge Functions           │
        └──────────────────────────────┘
```

### 2.3 External Integrations

1. **Microsoft Teams (Outbound)**
   - Endpoint: `POST /api/requests` → Teams Adaptive Card
   - Library: `backend/src/lib/teams.js`
   - Function: Posts request notifications to Teams channel

2. **Microsoft Teams (Inbound - Power Automate)**
   - Flow: Office_Boy_Sync in Power Automate
   - Trigger: New channel message with attachment
   - Action: POST to `/api/bills/webhook?key=app_wizz_secure_782`

3. **Telegram Bot**
   - Endpoint: `POST /api/telegram/webhook?key=TELEGRAM_WEBHOOK_KEY`
   - Library: `backend/src/lib/telegramWebhook.js`
   - Function: Receive bills via Telegram, reply with status

4. **Make.com / Zapier Webhooks**
   - Endpoint: `POST /api/bills/webhook?key=BILL_WEBHOOK_KEY`
   - Key: `app_wizz_secure_782`
   - Function: Receive bills from external services

---

## 3. USER ROLES & PERMISSIONS

### 3.1 Role Hierarchy

```sql
CREATE TYPE user_role AS ENUM (
  'leadership',         -- Super admin (Ramakrishna)
  'facility_manager',   -- Pantry manager + request fulfillment
  'finance',           -- Accounts team, bill verification
  'office_boy',        -- Request fulfillment only (inventory-blind)
  'staff'             -- Regular employees (request-only)
);
```

### 3.2 Role-Based Access Matrix

| Feature | Leadership | Facility Manager | Finance | Office Boy | Staff |
|---------|-----------|------------------|---------|------------|-------|
| **Dashboard** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Daily Stock Update** | ✅ | ✅ |  | ❌ | ❌ |
| **Inventory View** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Finance Reports** | ✅ | ❌ | ✅ | ❌ |  |
| **AI Summaries** | ✅ | ❌ | ✅ | ❌ |  |
| **Submit Requests** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Request Queue** | ✅ | ✅ | ❌ | ✅ | ❌ |
| **Live Tracking** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Bill Upload** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Bill Approval** | ✅ | ❌ | ✅ | ❌ |  |
| **Admin (User Management)** | ✅ | ❌ | ❌ | ❌ |  |
| **Audit Logs** | ✅ |  | ❌ | ❌ | ❌ |
| **Connections Setup** | ✅ | ❌ |  | ❌ | ❌ |
| **AI Preferences** | ✅ | ✅ | ✅ | ✅ | ✅ |

### 3.3 Auto-Promotion Rules

**Domain Gate:** Only `@applywizz.ai` emails can sign up

**Auto-Promotion:**
```sql
-- Migration 0002: Auto-promote Ramakrishna
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email = 'ramakrishna@applywizz.ai' THEN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', 'leadership');
  ELSE
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', 'staff');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 4. MODULES & FEATURES

### MODULE A: Inventory & Pantry Management

#### 4.1 Overview
**Goal:** Real-time tracking of 34+ pantry items with daily stock updates and price tracking.

#### 4.2 Database Schema

**Table: `products`**
```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  category PRODUCT_CATEGORY NOT NULL,  -- consumables, coffee_materials, washroom, beverages
  unit PRODUCT_UNIT NOT NULL,          -- pieces, packs, kg, liters, boxes
  cost_per_unit NUMERIC(10,2) NOT NULL CHECK (cost_per_unit >= 0),
  shelf_life_days INT,
  supplier_hyperpure_id TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Table: `inventory`**
```sql
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID UNIQUE REFERENCES products(id),
  current_stock NUMERIC(10,2) DEFAULT 0,
  min_threshold NUMERIC(10,2) DEFAULT 0,
  date_added DATE,
  expiry_date DATE,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  last_updated_by UUID REFERENCES profiles(id)
);
```

**Table: `transactions`**
```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID REFERENCES products(id),
  transaction_type TRANSACTION_TYPE NOT NULL,  -- add, remove, waste, adjust
  quantity NUMERIC(10,2) NOT NULL,
  unit_price NUMERIC(10,2),
  total_cost NUMERIC(10,2),
  performed_by UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Views:**
- `v_inventory_status` - Current stock status (in-stock, low, out, expiring, expired)
- `v_monthly_spending` - Monthly spend by category

#### 4.3 Backend Endpoints

```javascript
// Products CRUD
GET    /api/products                      // All products (all roles)
POST   /api/products                      // Create product (facility_manager, leadership)
GET    /api/products/:id                  // Get single product
PATCH  /api/products/:id                  // Update product (facility_manager, leadership)
DELETE /api/products/:id                  // Soft delete (facility_manager, leadership)

// Inventory
GET    /api/inventory                     // Current inventory status
GET    /api/inventory/alerts              // Low stock & expiry alerts
PATCH  /api/inventory/:productId          // Update stock (facility_manager, leadership)
POST   /api/inventory/daily-update        // Bulk daily update (facility_manager, leadership)

// Transactions
GET    /api/transactions                  // Transaction history (facility_manager, finance, leadership)
POST   /api/transactions                  // Log transaction (facility_manager, leadership)

// Reports
GET    /api/reports/spending              // Monthly spending report (finance, leadership)
GET    /api/reports/dashboard             // Dashboard stats (all operational roles)
```

#### 4.4 Frontend Pages

**`/dashboard` - Dashboard.jsx**
- 6 stat cards: In Stock, Low Stock, Out of Stock, Expiring Soon, Expired, Total Value
- Product table with sortable columns
- AI Summary widget (leadership/finance only)
- Real-time data from `/api/reports/dashboard`

**`/daily-update` - DailyUpdate.jsx**
- Card-based UI for each product
- Input fields: Count + Unit Price
- On save:
  - Calculates delta (new - old stock)
  - Logs transaction (`add` if positive, `remove` if negative)
  - Updates `products.cost_per_unit` if price changed
  - Updates `inventory.current_stock`
- Only visible to: facility_manager, leadership

**`/finance` - Finance.jsx**
- Recharts stacked bar chart: Monthly spending by category
- INR currency formatting
- Date range selector
- Data from: `v_monthly_spending` view
- Only visible to: finance, leadership

**`/available` - StaffView.jsx**
- Simplified product list (operational view)
- Shows: Name, Category, Current Stock, Status
- Hidden from staff (enforced by migration 0008)

#### 4.5 Business Logic

**Daily Update Flow:**
```javascript
// backend/src/routes/inventory.js
POST /api/inventory/daily-update

Input: {
  updates: [
    { productId, newStock, unitPrice },
    ...
  ]
}

Process:
1. For each update:
   a. Get current stock from inventory table
   b. Calculate delta = newStock - currentStock
   c. If delta !== 0:
      - Log transaction (add/remove)
      - Update inventory.current_stock
   d. If unitPrice changed:
      - Update products.cost_per_unit
      - Log who changed it and when
2. Return summary of changes
```

---

### MODULE B: Weekly AI Summary

#### 4.6 Overview
**Goal:** Auto-generated 4-bullet weekly digest of pantry insights for leadership.

#### 4.7 Database Schema

**Table: `ai_summaries`**
```sql
CREATE TABLE ai_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  summary JSONB NOT NULL,  -- {highlights, anomalies, recommendations, spend_summary}
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  generated_by UUID REFERENCES profiles(id),
  UNIQUE(period_start, period_end)
);
```

#### 4.8 Backend Logic

```javascript
// backend/src/routes/aiSummary.js
GET /api/reports/ai-summary?refresh=true

Process:
1. Calculate current week (Monday-Sunday)
2. Fetch from cache (ai_summaries table)
3. If not found or refresh=true:
   a. Gather context:
      - This week vs prev week spend comparison
      - Top 3 consumed products
      - Low stock items (< min_threshold)
      - Expiring items (within 7 days)
      - Transaction anomalies (unusual spikes)
   b. Call OpenAI GPT-4o-mini with prompt:
      "Generate a 4-bullet weekly summary for the COO..."
   c. Cache result in ai_summaries table
4. Return summary
```

**AI Prompt Structure:**
```javascript
const AI_SUMMARY_PROMPT = `
You are the Applywizz Pantry AI Assistant.
Generate a concise 4-bullet weekly summary for the COO.

FORMAT:
{
  "highlights": ["bullet 1", "bullet 2"],
  "anomalies": ["bullet 3"],
  "recommendations": ["bullet 4"],
  "spend_summary": {
    "this_week": 12500,
    "last_week": 9800,
    "change_percent": 27.5
  }
}

CONTEXT:
- This week spend: ₹12,500
- Last week spend: ₹9,800
- Top consumed: Coffee beans (15kg), Sugar (8kg)
- Low stock: Milk (2L), Bread (3 packs)
- Expiring: Peanut butter (2 days)
- Anomaly: Tea consumption up 150% vs avg
`;
```

#### 4.9 Frontend Integration

**Dashboard Widget:**
```jsx
// frontend/src/pages/Dashboard.jsx
const AISummaryCard = ({ summary, onRefresh }) => (
  <div className="card">
    <h3>🤖 AI Weekly Summary</h3>
    <ul>
      {summary.highlights.map(h => <li key={h}>✅ {h}</li>)}
      {summary.anomalies.map(a => <li key={a}>⚠️ {a}</li>)}
      {summary.recommendations.map(r => <li key={r}>💡 {r}</li>)}
    </ul>
    <button onClick={onRefresh}>🔄 Refresh</button>
  </div>
);
```

---

### MODULE C: Microsoft Authentication & Admin

#### 4.10 Overview
**Goal:** Secure login via Microsoft (Azure AD) with role-based access control.

#### 4.11 Authentication Flow

```
1. User clicks "Sign in with Microsoft"
2. Redirects to Supabase Azure OAuth
3. Supabase validates @applywizz.ai domain
4. On success:
   a. Creates auth.users record
   b. Triggers handle_new_user() function
   c. Auto-promotes ramakrishna@applywizz.ai to leadership
   d. Defaults new users to staff role
5. Redirects to /dashboard
6. Frontend stores JWT in localStorage
```

#### 4.12 Admin Features

**`/admin` - Admin.jsx**
- **User List:** All users with role pills
- **Invite User:** Email input + role dropdown
- **Change Role:** Click role pill to change
- **Only visible to:** leadership

**Backend Endpoints:**
```javascript
GET    /api/admin/users          // List all users (leadership)
PATCH  /api/admin/users/:id/role // Change role (leadership)
POST   /api/admin/users/invite   // Invite user via email (leadership)
```

---

### MODULE D: Employee Requests (Office Concierge)

#### 4.13 Overview
**Goal:** Natural language request submission with AI parsing and Teams notification.

#### 4.14 Database Schema

**Table: `requests`**
```sql
CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES profiles(id),
  request_type TEXT NOT NULL,        -- coffee, tea, snack, bread, lunch
  item TEXT NOT NULL,
  quantity INT DEFAULT 1,
  location TEXT NOT NULL,            -- Balaji Cabin, RK Cabin, etc.
  priority TEXT DEFAULT 'normal',    -- low, normal, high, urgent
  instruction TEXT,
  status TEXT DEFAULT 'pending',     -- pending, accepted, preparing, on_the_way, done, cancelled
  live_status TEXT,                  -- Same as status (for live tracking)
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  on_the_way_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  issue_reason TEXT,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  rating_status TEXT DEFAULT 'pending',  -- pending, rated
  feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**View: `v_request_queue`**
```sql
CREATE VIEW v_request_queue AS
SELECT 
  r.*,
  p.full_name as employee_name,
  p.role as employee_role
FROM requests r
JOIN profiles p ON r.employee_id = p.id
WHERE r.status != 'cancelled'
ORDER BY 
  CASE r.priority
    WHEN 'urgent' THEN 1
    WHEN 'high' THEN 2
    WHEN 'normal' THEN 3
    WHEN 'low' THEN 4
  END,
  r.created_at ASC;
```

#### 4.15 AI Request Parser

**Location Chips:**
- Balaji Cabin
- RK Cabin
- Manisha Cabin
- Resume Cabin
- Tech Team
- Marketing Team
- Conference Room

**AI System Prompt:**
```javascript
const PARSER_SYSTEM = `
You are the "Applywizz Office Concierge" AI.
Tone: WITTY, ENERGETIC, PERSONABLE (like Zomato push notifications)
Target audience: 23-25 year old office team

OFFICE CULTURE:
- Working Hours: 9 AM - 5 PM, Mon-Fri
- Lunch: 1 PM - 2 PM (No orders during this time)
- Assets: CCD Coffee Machine, Fresh Bread, Peanut Butter, Mixed Fruit Jam
- Tea/Coffee breaks: 11 AM, 4 PM

Extract JSON:
{
  "employee_name": "string",
  "request_type": "coffee|tea|snack|bread|lunch",
  "item": "string",
  "quantity": number,
  "location": "string",
  "priority": "low|normal|high|urgent",
  "instruction": "string",
  "missing_details": ["array"],
  "follow_up_question": "string",
  "needs_followup": boolean
}

RULES:
1. If location missing → needs_followup: true
2. If item unclear → needs_followup: true
3. During lunch hours (1-2 PM) → reject with witty message
4. Add emojis to follow_up_question
5. Keep it fun but professional
`;
```

**Request Flow:**
```javascript
// frontend/src/pages/RequestSubmit.jsx
1. User types: "Coffee for Cabin 2"
2. Selects location chip (optional)
3. Submits to: POST /api/requests
4. Backend calls GPT-4o-mini with parser prompt
5. If needs_followup:
   - Returns witty question
   - Frontend shows follow-up modal
6. If complete:
   - Inserts into requests table
   - Calls postRequestToTeams()
   - Returns request ID
   - Redirects to /track/:id
```

#### 4.16 Microsoft Teams Integration (Outbound)

**`backend/src/lib/teams.js`**
```javascript
export async function postRequestToTeams(request) {
  const adaptiveCard = {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        type: "AdaptiveCard",
        body: [
          { type: "TextBlock", text: `🆕 New Request #${request.id}`, weight: "Bolder", size: "Large" },
          { type: "FactSet", facts: [
            { title: "Employee", value: request.employee_name },
            { title: "Item", value: `${request.item} x${request.quantity}` },
            { title: "Location", value: request.location },
            { title: "Priority", value: request.priority.toUpperCase() },
            { title: "Status", value: request.status }
          ]},
          { type: "TextBlock", text: request.instruction, isSubtle: true }
        ],
        actions: [{
          type: "Action.OpenUrl",
          title: " Open in App to Accept",
          url: `${APP_PUBLIC_URL}/queue`
        }]
      }
    }]
  };

  await axios.post(TEAMS_WEBHOOK_URL, adaptiveCard);
}
```

#### 4.17 Request Queue Management

**`/queue` - RequestQueue.jsx**
- Filter tabs: Pending | In Progress | Done | All
- Cards show: Employee name, item, quantity, location, priority, status
- Actions:
  - **Start** (pending → accepted)
  - **Mark Done** (preparing → done)
  - **Cancel** (any → cancelled, requires reason)
- Auto-refresh every 10 seconds
- Only visible to: office_boy, facility_manager, leadership

**Status Transitions:**
```
pending → accepted → preparing → on_the_way → done
                     ↓
                 cancelled (with reason)
```

---

### MODULE E: Live Tracking (Zomato-Style)

#### 4.18 Overview
**Goal:** Real-time request tracking with 5-stage timeline and star rating.

#### 4.19 Frontend Implementation

**`/track/:id` - LiveTracking.jsx**

**Timeline Stages:**
1.  **Placed** - Request submitted
2. ✅ **Accepted** - Office boy accepted
3. ☕ **Preparing** - Being made
4. 🚶 **On the Way** - Delivering
5. ⭐ **Delivered** - Completed

**Features:**
- Animated active stage dot (framer-motion pulse)
- Polls `/api/requests` every 5 seconds
- Status-based color coding:
  - Pending: Gray
  - Accepted: Blue
  - Preparing: Orange
  - On the Way: Purple
  - Done: Green
  - Cancelled: Red

**Rating Modal:**
```javascript
// Triggered when: status === 'done' && rating_status === 'pending'
1. Shows 5-star rating UI
2. Optional feedback textarea
3. Submits to: POST /api/requests/:id/rate
4. Backend:
   a. Updates request.rating and request.feedback
   b. Sets rating_status = 'rated'
   c. Async calls learnFromRating() for AI learning
5. Shows "Thank you!" message
```

**AI Learning Integration:**
```javascript
// backend/src/lib/learning.js
export async function learnFromRating(employeeId, rating, comment) {
  // Scoring rules:
  // 5 stars = +10 points
  // 4 stars = +6 points
  // 3 stars = 0 points
  // 2 stars = -5 points
  // 1 star = -10 points
  
  // Taste extraction from comments:
  // "too sweet" → sugar_preference = "Less sugar"
  // "strong coffee" → coffee_strength = "Strong"
  // "no milk" → milk_preference = "No milk"
  
  // Updates:
  // - employee_preference_scores
  // - employee_ai_preferences
  // - employee_taste_preferences
}
```

---

### MODULE F: Vendor Bill OCR (3 Entry Points)

#### 4.20 Overview
**Goal:** Automated bill processing with OpenAI Vision for item extraction and inventory sync.

#### 4.21 Database Schema

**Table: `bill_uploads`**
```sql
CREATE TABLE bill_uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_url TEXT NOT NULL,
  file_type TEXT,              -- pdf, jpg, png
  invoice_number TEXT,
  vendor_name TEXT,
  bill_date DATE,
  total_amount NUMERIC(10,2),
  verification_status TEXT DEFAULT 'Pending Admin Verification',
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Table: `bill_items`**
```sql
CREATE TABLE bill_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID REFERENCES bill_uploads(id),
  item_name TEXT NOT NULL,
  quantity NUMERIC(10,2),
  unit_price NUMERIC(10,2),
  total_price NUMERIC(10,2),
  matched_product_id UUID REFERENCES products(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.22 Three Entry Points

**Entry Point 1: In-App Upload**
```javascript
// frontend/src/pages/BillUpload.jsx
1. User uploads PDF/Image
2. Frontend uploads to Supabase Storage: /bills/manual/{filename}
3. Calls: POST /api/bills/extract with file_url
4. Backend:
   a. If PDF → GPT-4o Responses API
   b. If Image → GPT-4o Vision API
   c. Extracts structured JSON:
      {
        invoice_number,
        vendor_name,
        bill_date,
        total_amount,
        items: [{name, quantity, unit_price, total_price}]
      }
   d. Checks for duplicates (by invoice_number)
   e. If duplicate → Returns Hindi roast message:
      "Bhaiya, ye bill toh pehle hi aa chuka hai! 😅"
   f. Saves to bill_uploads + bill_items
   g. Status: "Pending Admin Verification"
```

**Entry Point 2: External Webhook (Make.com/Zapier)**
```javascript
// backend/src/routes/billWebhook.js
POST /api/bills/webhook?key=app_wizz_secure_782

Authentication: Query string key (NO JWT required)
Accepts:
  - Multipart file upload
  - JSON with file_url

Process:
1. Validates BILL_WEBHOOK_KEY
2. If file uploaded:
   - Uploads to Supabase Storage: /bills/power-automate/{filename}
3. Same extraction flow as Entry Point 1
4. Returns success/failure JSON
```

**Entry Point 3: Telegram Bot**
```javascript
// backend/src/routes/telegramWebhook.js
POST /api/telegram/webhook?key=TELEGRAM_WEBHOOK_KEY

Process:
1. Validates TELEGRAM_WEBHOOK_KEY
2. Extracts file_id from Telegram message
3. Downloads file from Telegram API
4. Uploads to Supabase Storage: /bills/telegram/{filename}
5. Same extraction flow
6. Replies to user in Telegram:
   - Success: "✅ Bill processed! ₹2,500 for 15 items."
   - Duplicate: "Bhaiya, ye bill toh pehle se hai! 😅"
```

#### 4.23 Duplicate Detection

```javascript
// backend/src/lib/billProcessor.js
async function checkDuplicate(invoiceNumber) {
  const { data } = await supabaseAdmin
    .from('bill_uploads')
    .select('id')
    .eq('invoice_number', invoiceNumber)
    .single();
  
  if (data) {
    const roastMessages = [
      "Bhaiya, ye bill toh pehle hi aa chuka hai! 😅",
      "Duplicate alert! Kya aap copy-paste kar rahe ho? 🤔",
      "Arre bhai, same bill do baar? ",
      "Ye bill already processed hai boss! ✅",
      "Duplicate mil gaya! System smart hai yaar "
    ];
    return { isDuplicate: true, message: roastMessages[Math.floor(Math.random() * 5)] };
  }
  return { isDuplicate: false };
}
```

#### 4.24 Bill Approval & Inventory Sync

**`/bills/approve` - BillApproval.jsx**
- Lists all bills with status "Pending Admin Verification"
- Admin can:
  - **Verify** → Changes status to "Admin Verified"
  - **Reject** → Changes status to "Rejected"
- On verification:
  ```javascript
  // backend/src/routes/bills.js
  PATCH /api/bills/:id/status
  
  If status === 'Admin Verified':
    1. For each bill_item:
       a. Try to match item_name to products.name (case-insensitive substring)
       b. If match found:
          - Update inventory.current_stock += quantity
          - Log transaction with total_cost
    2. Return sync summary
  ```

#### 4.25 AI Extraction Prompts

**For Images (GPT-4o Vision):**
```javascript
const VISION_PROMPT = `
Extract bill details as JSON:
{
  "invoice_number": "string",
  "vendor_name": "string",
  "bill_date": "YYYY-MM-DD",
  "total_amount": number,
  "items": [
    {
      "name": "string",
      "quantity": number,
      "unit_price": number,
      "total_price": number
    }
  ]
}

Rules:
- If invoice_number missing → use "UNKNOWN-{timestamp}"
- Extract ALL items, even if blurry
- Guess quantities if not clear
- Return ONLY JSON, no markdown
`;
```

**For PDFs (GPT-4o Responses API):**
```javascript
const PDF_PROMPT = `
You are a bill extraction AI.
Read the PDF and extract structured data.

Return JSON format:
{...same as above...}

Handle:
- Multi-page bills
- Tables
- Handwritten notes
- Indian currency (₹)
- GST amounts
`;
```

---

### MODULE G: AI Personalization Brain

#### 4.26 Overview
**Goal:** Self-learning AI that personalizes employee notifications based on behavior.

#### 4.27 Database Schema

**Table: `employee_ai_preferences`**
```sql
CREATE TABLE employee_ai_preferences (
  employee_id UUID PRIMARY KEY REFERENCES profiles(id),
  preferred_drink TEXT,              -- coffee, tea, green_tea, lemon_tea
  secondary_drink TEXT,
  sugar_preference TEXT,             -- normal, less_sugar, no_sugar
  coffee_strength TEXT,              -- normal, strong, mild
  milk_preference TEXT,              -- normal, less_milk, no_milk
  preferred_morning_time TIME,       -- e.g., 10:30:00
  preferred_afternoon_time TIME,     -- e.g., 15:30:00
  reminder_enabled BOOLEAN DEFAULT TRUE,
  notification_tone TEXT,            -- mom_mode, friendly, professional, funny, minimal
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Table: `employee_preference_scores`**
```sql
CREATE TABLE employee_preference_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES profiles(id),
  preference_type TEXT NOT NULL,     -- drink, sugar, strength, time, tone
  preference_value TEXT NOT NULL,    -- e.g., "coffee", "less_sugar"
  score INT DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, preference_type, preference_value)
);
```

**Table: `employee_taste_preferences`**
```sql
CREATE TABLE employee_taste_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES profiles(id),
  item_name TEXT NOT NULL,
  sugar_preference TEXT,
  strength_preference TEXT,
  milk_preference TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, item_name)
);
```

**Table: `employee_notification_behavior`**
```sql
CREATE TABLE employee_notification_behavior (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES profiles(id),
  notification_type TEXT NOT NULL,   -- morning_reminder, afternoon_reminder
  sent_at TIMESTAMPTZ NOT NULL,
  clicked BOOLEAN DEFAULT FALSE,
  skipped BOOLEAN DEFAULT FALSE,
  engagement_score INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Table: `employee_reminder_policy`**
```sql
CREATE TABLE employee_reminder_policy (
  employee_id UUID PRIMARY KEY REFERENCES profiles(id),
  morning_time TIME,
  afternoon_time TIME,
  pause_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Table: `employee_daily_learning_logs`**
```sql
CREATE TABLE employee_daily_learning_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES profiles(id),
  activity_summary TEXT,
  new_profile_snapshot JSONB,
  learning_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.28 AI Learning System

**`backend/src/lib/learning.js`**

**Scoring Rules:**
```javascript
const SCORING_RULES = {
  ordered_item: +10,
  clicked_notification: +8,
  rated_5_stars: +10,
  rated_4_stars: +6,
  skipped_item: -5,
  ignored_notification: -3,
  rated_1_2_stars: -10,
  complaint_about_item: -8,
  accepted_alternative: +12
};
```

**Taste Extraction Rules:**
```javascript
const TASTE_RULES = {
  "too sweet": { sugar: "Less sugar" },
  "strong coffee": { strength: "Strong" },
  "no milk": { milk: "No milk" },
  "weak": { strength: "Mild" },
  "sweet": { sugar: "More sugar" }
};
```

**Learning Flow:**
```javascript
// Triggered on rating submission
async function learnFromRating(employeeId, rating, comment) {
  // 1. Update preference scores
  const score = rating * 2;  // 5 stars = 10 points
  await updatePreferenceScore(employeeId, 'rating', 'overall', score);
  
  // 2. Extract taste preferences from comment
  if (comment) {
    const { content } = await chatCompletion({
      system: LEARNING_SYSTEM,
      user: JSON.stringify({ comment, rating }),
      model: 'gpt-4o-mini'
    });
    
    const tasteUpdate = JSON.parse(content);
    if (tasteUpdate.updated_preferences) {
      await updateTastePreferences(employeeId, tasteUpdate);
    }
  }
}
```

#### 4.29 AI Recommendation Engine

**`backend/src/lib/recommendations.js`**
```javascript
export async function getAIDecision(employeeId) {
  // 1. Fetch employee profile & scores
  const { data: prefs } = await supabaseAdmin
    .from('employee_ai_preferences')
    .where({ employee_id: employeeId })
    .single();
  
  const { data: scores } = await supabaseAdmin
    .from('employee_preference_scores')
    .where({ employee_id: employeeId });
  
  // 2. Calculate best drink/time/tone based on scores
  const bestDrink = scores
    .filter(s => s.preference_type === 'drink')
    .sort((a, b) => b.score - a.score)[0];
  
  const bestTime = getCurrentTime() < '13:00' 
    ? prefs.preferred_morning_time 
    : prefs.preferred_afternoon_time;
  
  const bestTone = prefs.notification_tone || 'friendly';
  
  // 3. Generate personalized message
  const { content } = await chatCompletion({
    system: RECOMMENDATION_PROMPT,
    user: JSON.stringify({ prefs, scores, bestDrink, bestTime, bestTone }),
    model: 'gpt-4o-mini'
  });
  
  return JSON.parse(content);
  // Returns:
  // {
  //   send_notification: true,
  //   type: "coffee_reminder",
  //   tone: "friendly",
  //   title: "☕ Coffee Break Time!",
  //   message: "Hey [Name]! Your favorite coffee is ready. Want one?",
  //   buttons: ["Yes, please!", "Not now", "Change preference"]
  // }
}
```

#### 4.30 Frontend Preferences Page

**`/settings` - Preferences.jsx**
- **Drink Preferences:** Dropdown for preferred drink, sugar, strength, milk
- **Notification Tone:** Radio buttons (Mom Mode, Friendly, Professional, Funny, Minimal)
- **Reminder Times:** Time pickers for morning/afternoon
- **Opt-in Toggle:** Enable/disable AI nudges
- **Preference History:** Shows learned preferences over time

---

### MODULE H: Audit Logs & Insights

#### 4.31 Database Schema

**Table: `audit_logs`**
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,              -- create, update, delete, approve
  resource_type TEXT NOT NULL,       -- product, inventory, bill, request
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Table: `teams_activity_logs`**
```sql
CREATE TABLE teams_activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID REFERENCES requests(id),
  message TEXT,
  status TEXT,                       -- sent, failed
  response_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Table: `notification_logs`**
```sql
CREATE TABLE notification_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES profiles(id),
  notification_type TEXT NOT NULL,
  sent_via TEXT,                     -- teams, telegram, in_app
  status TEXT,                       -- sent, clicked, skipped
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.32 Frontend Pages

**`/reports` - AuditLog.jsx**
- Filter by: Date range, User, Action, Resource type
- Table columns: Timestamp, User, Action, Resource, Details
- Export to CSV button
- Only visible to: leadership

**`/connections` - Connections.jsx**
- Shows webhook URLs:
  - Bill webhook: `https://inventory-vgor.onrender.com/api/bills/webhook?key=app_wizz_secure_782`
  - Telegram webhook: `https://inventory-vgor.onrender.com/api/telegram/webhook?key=...`
- Setup instructions for:
  - Make.com / Zapier integration
  - WhatsApp Business API
  - Telegram bot configuration
- Only visible to: leadership

---

## 5. API REFERENCE

### 5.1 Authentication

All endpoints (except webhooks) require:
```
Authorization: Bearer <supabase-jwt-token>
```

### 5.2 Complete Endpoint List

```
# Health Check
GET  /health

# Public Webhooks (Key-Gated)
POST /api/bills/webhook?key=BILL_WEBHOOK_KEY
POST /api/telegram/webhook?key=TELEGRAM_WEBHOOK_KEY

# Products
GET    /api/products                      # All roles
POST   /api/products                      # facility_manager, leadership
GET    /api/products/:id                  # All roles
PATCH  /api/products/:id                  # facility_manager, leadership
DELETE /api/products/:id                  # facility_manager, leadership (soft delete)

# Inventory
GET    /api/inventory                     # facility_manager, leadership
GET    /api/inventory/alerts              # facility_manager, leadership
PATCH  /api/inventory/:productId          # facility_manager, leadership
POST   /api/inventory/daily-update        # facility_manager, leadership

# Transactions
GET    /api/transactions                  # facility_manager, finance, leadership
POST   /api/transactions                  # facility_manager, leadership

# Reports
GET    /api/reports/spending              # finance, leadership
GET    /api/reports/dashboard             # facility_manager, finance, leadership
GET    /api/reports/ai-summary            # finance, leadership
GET    /api/reports/ai-summary/history    # finance, leadership

# Admin
GET    /api/admin/users                   # leadership
PATCH  /api/admin/users/:id/role          # leadership
POST   /api/admin/users/invite            # leadership

# Requests
POST   /api/requests                      # All authenticated users
GET    /api/requests                      # All authenticated users
PATCH  /api/requests/:id/status           # office_boy, facility_manager, leadership
POST   /api/requests/:id/rate             # All authenticated users

# Bills
POST   /api/bills/extract                 # office_boy, admin, leadership, finance
PATCH  /api/bills/:id/status              # admin, leadership, finance
GET    /api/bills                         # office_boy, admin, leadership, finance
```

---

## 6. ENVIRONMENT VARIABLES

### 6.1 Backend (.env)

```bash
PORT=4000
NODE_ENV=development

SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...your_service_role_key...

ALLOWED_ORIGINS=http://localhost:5173,https://inventory-ashen-theta.vercel.app
APP_PUBLIC_URL=https://inventory-ashen-theta.vercel.app

OPENAI_API_KEY=sk-...your_openai_key...

TEAMS_WEBHOOK_URL=https://...teams_webhook_url...
BILL_WEBHOOK_KEY=app_wizz_secure_782
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_KEY=app_wizz_telegram_secret
```

### 6.2 Frontend (.env.local)

```bash
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...your_anon_key...
VITE_API_BASE_URL=https://inventory-vgor.onrender.com
VITE_BILL_WEBHOOK_URL=https://inventory-vgor.onrender.com/api/bills/webhook?key=app_wizz_secure_782
```

---

## 7. DEPLOYMENT CONFIGURATION

### 7.1 Vercel (Frontend)

**vercel.json (root):**
```json
{
  "buildCommand": "cd frontend && npm install && npm run build",
  "outputDirectory": "frontend/dist",
  "rewrites": [
    { "source": "/(.*)", "destination": "/" }
  ]
}
```

**Environment Variables:**
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_API_BASE_URL
- VITE_BILL_WEBHOOK_URL

### 7.2 Render (Backend)

**railway.json:**
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start"
  }
}
```

**Environment Variables:**
- PORT=10000
- NODE_ENV=production
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ALLOWED_ORIGINS
- APP_PUBLIC_URL
- OPENAI_API_KEY
- TEAMS_WEBHOOK_URL
- BILL_WEBHOOK_KEY
- TELEGRAM_BOT_TOKEN
- TELEGRAM_WEBHOOK_KEY

---

## 8. WHAT'S NOT BUILT YET (GAPS)

### 8.1 Missing Features

| Feature | Status | Priority | Effort |
|---------|--------|----------|--------|
| **Two-way Teams buttons** | ❌ Not built | Medium | 2-3 days |
| **Browser push notifications (FCM)** | ❌ Not built | Low | 1-2 days |
| **Tea/coffee reminder scheduler** | ❌ Not built | High | 1 day |
| **Accounts Team distinct flow** | ⚠️ Partial | Low | 1 day |
| **Lottie animations** | ❌ Not built | Low | 2 hours |
| **"Cannot complete" reason capture** | ⚠️ Partial | Medium | 1 day |
| **Advanced reports (avg completion time, etc.)** | ❌ Not built | Medium | 2 days |
| **Office Boy mobile PWA** | ❌ Not built | Low | 3 days |
| **WhatsApp Business API integration** | ❌ Not built | Medium | 2 days |
| **Email notifications** |  Not built | Low | 1 day |

### 8.2 Recommended Next Steps

1. **Wire AI reminder scheduler** (High Priority)
   - Use Supabase pg_cron
   - Call `getAIDecision()` every 30 minutes during office hours
   - Send notifications via Teams/Telegram

2. **Implement Two-way Teams buttons** (Medium Priority)
   - Register Bot Framework app
   - Implement message signing & verification
   - Add Accept/Preparing/On the way/Done buttons to Adaptive Cards

3. **Add Lottie animations** (Low Priority, Quick Win)
   - Install `lottie-react`
   - Add coffee-pouring animation to LiveTracking page
   - Add success animation to rating modal

---

## 9. TESTING

### 9.1 Playwright E2E Tests

**Location:** `tests/e2e/smoke.spec.js`

**Test Scenarios:**
1. Login page renders
2. Dashboard redirects to login when signed out
3. Can open daily update and adjust counts
4. Dashboard renders inventory snapshot
5. Can submit a request
6. Request appears in queue
7. Can update request status
8. Can rate a completed request

**Run Tests:**
```bash
cd tests
npm install
npx playwright install --with-deps chromium
npm test
```

---

## 10. SECURITY

### 10.1 Row Level Security (RLS)

All tables have RLS enabled with role-aware policies:

**Example - Products:**
```sql
-- Everyone can read
CREATE POLICY "Products viewable by all" ON products
FOR SELECT USING (true);

-- Only facility_manager and leadership can modify
CREATE POLICY "Products modifiable by admins" ON products
FOR ALL USING (
  current_user_role() IN ('facility_manager', 'leadership')
);
```

### 10.2 Authentication

- **Domain Gate:** Only `@applywizz.ai` emails can sign up
- **JWT Tokens:** Supabase Auth provides short-lived JWTs (1 hour expiry)
- **Service Role Key:** Backend uses service role key for admin operations (never exposed to frontend)

### 10.3 API Security

- **CORS:** Configured with ALLOWED_ORIGINS
- **Rate Limiting:** 120 requests per minute per IP
- **Helmet.js:** Security headers (XSS protection, CSP, etc.)
- **Input Validation:** Zod schemas on all POST/PATCH endpoints

---

## 11. PERFORMANCE

### 11.1 Frontend Optimization

- **Code Splitting:** Vite automatic chunking
- **Lazy Loading:** Routes loaded on demand
- **Bundle Size:** 971 KB (gzipped: 278 KB)
- **Recommended:** Implement dynamic imports for heavy pages

### 11.2 Backend Optimization

- **Connection Pooling:** Supabase handles PostgreSQL connections
- **Caching:** AI summaries cached in database
- **Rate Limiting:** Prevents abuse
- **Recommended:** Add Redis for session caching

---

## 12. MAINTENANCE & MONITORING

### 12.1 Logging

**Backend:**
- Morgan HTTP logging (dev: detailed, prod: combined format)
- Console.error for all caught errors
- Teams activity logged to database

**Frontend:**
- Console logging in development
- Error boundaries on all pages

### 12.2 Monitoring Recommendations

1. **Vercel Analytics** - Frontend performance
2. **Render Logs** - Backend errors & performance
3. **Supabase Dashboard** - Database queries & auth
4. **OpenAI Usage Dashboard** - API costs
5. **Sentry** (Recommended) - Error tracking

---

## 13. APPENDIX

### 13.1 File Structure

```
inventory/
── frontend/                      # React + Vite + Tailwind
│   ├── src/
│   │   ├── components/
│   │   │   └── Layout.jsx        # Main layout with navigation
│   │   ├── hooks/
│   │   │   └── useAuth.js        # Authentication hook
│   │   ├── lib/
│   │   │   ├── api.js            # API client
│   │   │   ├── culture.js        # Office culture constants
│   │   │   └── supabase.js       # Supabase client
│   │   ├── pages/                 # 14 page components
│   │   │   ├── Admin.jsx
│   │   │   ├── AuditLog.jsx
│   │   │   ├── BillApproval.jsx
│   │   │   ├── BillUpload.jsx
│   │   │   ├── Connections.jsx
│   │   │   ├── DailyUpdate.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Finance.jsx
│   │   │   ├── LiveTracking.jsx
│   │   │   ├── Login.jsx
│   │   │   ├── Preferences.jsx
│   │   │   ├── RequestQueue.jsx
│   │   │   ├── RequestSubmit.jsx
│   │   │   └── StaffView.jsx
│   │   ├── App.jsx                # React Router setup
│   │   ├── index.css              # Tailwind imports
│   │   └── main.jsx               # Entry point
│   ├── public/
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── package.json
│   └── vercel.json                # SPA routing config
│
├── backend/                       # Node.js + Express
│   ├── src/
│   │   ├── lib/
│   │   │   ├── learning.js       # AI learning algorithms
│   │   │   ├── openai.js         # OpenAI API client
│   │   │   ├── recommendations.js # AI recommendation engine
│   │   │   ├── supabase.js       # Supabase admin client
│   │   │   └── teams.js          # Teams Adaptive Cards
│   │   ├── middleware/
│   │   │   ├── auth.js           # JWT authentication
│   │   │   └── errorHandler.js   # Global error handling
│   │   ├── routes/                # 10 route files
│   │   │   ├── admin.js
│   │   │   ├── aiSummary.js
│   │   │   ├── billWebhook.js
│   │   │   ├── bills.js
│   │   │   ├── inventory.js
│   │   │   ├── products.js
│   │   │   ├── reports.js
│   │   │   ├── requests.js
│   │   │   ├── telegramWebhook.js
│   │   │   ── transactions.js
│   │   ├── scripts/
│   │   │   ├── cleanup.js
│   │   │   ├── expand_categories.js
│   │   │   └── seed_real_data.js
│   │   └── server.js              # Express app setup
│   ├── package.json
│   ├── railway.json
│   ├── Procfile
│   ├── vercel.json
│   └── .env.example
│
├── supabase/
│   ├── migrations/                # 8 SQL migrations
│   │   ├── 0001_init_schema.sql
│   │   ├── 0002_auth_policy.sql
│   │   ├── 0003_ai_summaries.sql
│   │   ├── 0004_requests.sql
│   │   ├── 0005_facility_management_core.sql
│   │   ├── 0006_advanced_ai_hospitality.sql
│   │   ├── 0007_self_learning_ai_brain.sql
│   │   └── 0008_staff_inventory_lockdown.sql
│   └── seed/
│       └── seed_products.sql      # 34 starter products
│
├── tests/                         # Playwright E2E
│   ├── e2e/
│   │   └── smoke.spec.js
│   ├── playwright.config.js
│   └── package.json
│
├── docs/                          # Documentation
│   ├── PRD_CURRENT_STATE.md
│   ├── architecture.md
│   ── microsoft-auth-setup.md
│
├── vercel.json                    # Root Vercel config
├── README.md
├── GETTING_STARTED.md
└── .gitignore
```

### 13.2 Database Migration Order

```sql
1. 0001_init_schema.sql            -- Core tables + RLS
2. 0002_auth_policy.sql            -- Microsoft auth + domain gate
3. 0003_ai_summaries.sql           -- Weekly AI summary cache
4. 0004_requests.sql               -- Employee requests + office_boy role
5. seed_products.sql               -- 34 starter products
6. 0005_facility_management_core.sql -- Bills, ratings, audit logs
7. 0006_advanced_ai_hospitality.sql -- AI preference brain
8. 0007_self_learning_ai_brain.sql  -- Scoring system
9. 0008_staff_inventory_lockdown.sql -- Block staff from inventory
```

### 13.3 Quick Start Commands

```bash
# Frontend
cd frontend
npm install
npm run dev              # http://localhost:5173

# Backend
cd backend
npm install
npm run dev              # http://localhost:4000

# Tests
cd tests
npm install
npx playwright install --with-deps chromium
npm test

# Build
cd frontend
npm run build            # Output to dist/
```

---

## 14. CONTACT & SUPPORT

**Repository:** https://github.com/GOODBOYKITTU272/Inventory  
**Frontend:** https://inventory-ashen-theta.vercel.app  
**Backend:** https://inventory-vgor.onrender.com  
**Documentation:** See `/docs` folder

---

**Document Version:** 2.0  
**Last Updated:** May 15, 2026  
**Total Pages:** ~50 pages  
**Total Modules:** 8 major modules  
**Total Endpoints:** 30+ API endpoints  
**Total Tables:** 25+ database tables  
**Total Lines of Code:** ~5,200+ (excluding lockfiles)
