# Applywizz Office Pantry — Product Requirements Document (PRD)

**Version:** 2.0  
**Date:** 22 May 2026  
**Author:** Development Team  
**Status:** Live + Iterating

---

## 1. Product Overview

**Applywizz Office Pantry** is an internal office cafeteria management system for Applywizz. Employees order beverages (via CCD Coffee Machine), snacks, and book daily meals — all delivered to their desk by the Office Boy.

### Core Value Proposition
- **Employees:** One-tap ordering, personalized preferences, live tracking
- **Office Boy:** Real-time queue, push notifications, delivery management
- **Leadership:** Cost tracking, meal reports, vendor bill management

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind CSS + Framer Motion |
| Backend | Express.js (Node.js) on Render |
| Database | Supabase (PostgreSQL) |
| Auth | Microsoft Authenticator (TOTP MFA via Supabase) |
| AI | GPT-4o-mini for natural language order parsing |
| Notifications | Web Push (VAPID) + Teams Power Automate |
| Hosting | Vercel (frontend) + Render (backend) |

---

## 2. User Roles & Permissions

| Role | Home | Can Access |
|------|------|-----------|
| **Staff (Applywizzian)** | /request | Cafeteria, Meals, Orders, Settings |
| **Office Boy** | /queue | Cafeteria, Meals, Orders, Queue, Bills, Settings |
| **Facility Manager** | /dashboard | Dashboard, Daily Update, Cafeteria, Meals, Orders, Queue, What's Available, Bills, Settings |
| **Finance** | /dashboard | Dashboard, Finance, Cafeteria, Meals, Orders, Available, Bills, Bill Approval, Settings |
| **Leadership** | /dashboard | ALL screens |

---

## 3. Authentication Flow

```
User opens app
    |
    v
[Login Page] ---> Microsoft SSO (Azure AD)
    |
    v
[TOTP MFA Step] ---> Enter 6-digit code from Microsoft Authenticator
    |
    v
AAL2 verified? --No--> Back to Login
    |Yes
    v
[Onboarding Check] ---> Query employee_cafeteria_preferences
    |
    v
onboarding_completed = true? --No--> [Onboarding Flow]
    |Yes                                    |
    v                                       v
[Main App (Role-based Home)]         [11-step setup wizard]
```

### Session Management
- Sessions persist across tab closes (Supabase handles refresh tokens)
- **15-minute inactivity lock screen** (planned)
- MFA required every fresh login (AAL2 enforcement)

---

## 4. Onboarding Flow (11 Steps)

First-time users complete this wizard before accessing the app.

```
Step 0: Welcome ("Welcome to Office Cafe")
Step 1: Display Name (what office boy sees)
Step 2: Work Shift (Morning 9-5 / Night 8PM-5:30AM)
Step 3: Drink Preferences (two-level: Category -> Sub-options)
Step 4: Snack Preferences
Step 5: Taste Preferences (dynamic based on drinks selected)
Step 6: Default Location (Balaji Cabin, RK Cabin, etc.)
Step 7: Reminders (Morning/Afternoon drink, Lunch, Hydration)
Step 8: Gender (for personalized notification tone)
Step 9: Notification Tone (Gen-Z / Friendly / Professional / Funny / Mom Mode / Boyfriend / Girlfriend)
Step 10: All Set! -> Start Ordering
```

### Drink Categories (Step 3)
```
CCD Coffee (expand to see):
  - Espresso, Latte, Cappuccino, Milk Coffee, Hot Chocolate, Badam Mix

Tea (expand to see):
  - Assam Tea, Elaichi Tea, Ginger Tea, Green Tea, Lemon Tea

Water (single tap)
None for me (single tap)
```

### Taste Preferences (Step 5 — Dynamic)
| If Selected | Taste Options Shown |
|------------|-------------------|
| Any CCD Coffee | Strong/Light Coffee, Less/No Sugar, With/Without Milk |
| Assam/Elaichi/Ginger Tea | Strong/Light Tea, Less/No Sugar |
| Green Tea | Plain, With Honey, With Lemon, Light/Strong Brew |
| Lemon Tea | Normal, Less Sugar, Strong/Mild Lemon, With/Without Honey |

### Gender-Based Tone (Steps 8-9)
- Male users see: Girlfriend Style option
- Female users see: Boyfriend Style option
- Gender is NEVER shown to office boy or anyone — only used for AI tone

### Data Saved
```sql
employee_cafeteria_preferences:
  user_id, preferred_name, drink_prefs (JSONB array),
  snack_prefs (JSONB array), taste_prefs (JSONB array),
  shift, preferred_location, reminder_enabled, reminder_time,
  notification_tone, gender, onboarding_completed
```

---

## 5. Main Cafeteria Screen (/request)

### Layout (Top to Bottom)
```
[Greeting Banner] "Good morning, Rama! ☀️"
[Preference Summary] -- Swiggy/Zomato style chips showing:
   📍 RK Cabin | ☕ Latte | 🍵 Ginger Tea | Less Sugar
[Meal Booking Card] -- Book lunch/dinner for tomorrow
[Active Order Banner(s)] -- "CCD Coffee - Preparing ☕" -> Track
[Category Sections]:
   ☕ Beverages: Assam Tea, Elaichi Tea, Ginger Tea, Green Tea, Lemon Tea,
                 Hot Chocolate, Water
   🍪 Snacks: Banana, Biscuits
   🥪 Food: Mix Fruit Jam, Pineapple Jam, Bread+PB, Bread+Jam
[AI Custom Request] -- Free text: "Get me something refreshing"
[Cart Bar] -- "2 items · Place Order"
```

### Item Chip States
| State | Visual |
|-------|--------|
| Available | White card, "Tap to add" |
| In Cart | Brand color, +/- buttons, quantity |
| Low Stock (servings <= 5) | Amber badge "Only 3 left!" |
| Out of Stock (servings = 0) | Grayed out, tone-specific message |
| Needs Bread (dependency) | "Needs bread 🍞" subtitle |
| Bread Unavailable | Disabled + dependency message |

### Ordering Flow
```
User taps item
    |
    v
Is Jam/PB (has sides_option)? --Yes--> [Jam Custom Sheet]
    |No                                  |-- Choose: One side / Both sides
    |                                    |-- Pick bread type
    |                                    v
Is Bread item? --Yes--> [Bread Custom Sheet]
    |No
    |
Is Beverage with tastes?
    |Yes
    |-- Has saved pref? --Yes--> Auto-apply (no popup)
    |   |No
    |   v
    |   [Beverage Custom Sheet]
    |   |-- Pick taste options
    |   |-- "Remember for next time" toggle
    |   v
    v
Add to Cart
    |
    v
[Cart Summary Bar] -- "2 items · Place Order"
    |
    v
[Order Sheet] -- Choose/confirm location, add notes
    |
    v
POST /api/requests (quick_item flow)
    |
    v
Backend:
  1. Stock check (stock_servings or stock_today)
  2. Dependency check (e.g., Bread for Jam)
  3. Decrement stock
  4. Insert into requests table
  5. Send push notification to office boy
  6. Post to Teams channel
    |
    v
[Success] -> Navigate to Live Tracking
    |
    v
[30-second Cancel Window] -- "Cancel Order ❌"
```

### Stock Management System
```
cafeteria_items table:
  stock_today    = raw units (boxes, packets, bottles)
  stock_servings = consumable units (cups, slices, servings)

CCD Machine Beverages:
  stock_today = 2 (boxes)
  stock_servings = 200 (cups, 100 per box)

Bread:
  stock_today = 3 (loaves)
  stock_servings = 42 (slices, 14 per loaf of 350g+)

Jam/PB:
  stock_today = packets
  stock_servings = approximate servings per packet

Frontend displays: stock_servings (if set) or stock_today
Backend checks: stock_servings first, then stock_today
On order: decrement stock_servings
On cancel: restore stock_servings
```

---

## 6. Live Tracking Screen (/track/:id)

```
[Order Card] -- Item name, quantity, location
[Progress Timeline]:
   📋 Placed (timestamp)
   ✅ Accepted (timestamp)
   ☕ Preparing (timestamp)
   🛵 On the way (timestamp)
   🎉 Delivered! (timestamp)
[ETA Bar] -- "~8 min · 3 orders ahead"
[Cancel Button] -- Only visible within 30s of placing
[Rating] -- After delivery: 1-5 stars + feedback
```

### Real-time Updates
- Supabase Realtime subscription on requests table
- Push notifications at each stage change
- Auto-navigate to delivered state

---

## 7. Office Boy Queue Screen (/queue)

```
[Pending Tab] | [In Progress Tab] | [Done Tab]
    |
    v
[Order Card]:
  - Employee name + avatar
  - Item + quantity
  - Location
  - AI instruction (witty message)
  - Time elapsed
  - Action buttons: Accept / Mark Preparing / On the Way / Done / Cancel
```

### Office Boy Flow
```
New order arrives (push notification)
    |
    v
[Queue] -- See pending order
    |
    v
Tap "Accept" -> status: in_progress, live_status: accepted
    |
    v
Tap "Preparing" -> live_status: preparing
    |
    v
Tap "On the Way" -> live_status: on_the_way
    |
    v
Tap "Done" -> status: done, live_status: done
    |           (push notification sent to employee)
    |
    v
[Order moves to Done tab]
```

---

## 8. Meal Booking Screen (/meals)

### Morning Shift Employees
- Book by **6 PM** for next day's lunch
- Cancel till **8 PM**

### Night Shift Employees
- Book by **2 PM** for same day's dinner
- Cancel till **5 PM**

```
[7-Day Calendar Strip]
    |
    v
[Date Card]:
  Today's choice: [Veg 🥬] [Non-Veg 🍗] [Egg 🥚] [Skip 🚫]
    |
    v
[Confirmation Bottom Sheet]:
  "Book Veg for tomorrow (Fri, 23 May)?"
  [Confirm] [Cancel]
    |
    v
POST /api/meals/book
    |
    v
[Success Toast] "Meal booked!"
[History Button] -> /meal-history
```

### Meal History (/meal-history)
- Month picker dropdown
- Summary: X Veg, Y Non-Veg, Z Egg, W Skipped
- Individual booking cards with date and booked-at time

---

## 9. Order History Screen (/orders)

```
[Filter Tabs]: All | Active | Delivered | Cancelled
[Search Bar]
[Date Groups]: Today / Yesterday / Date
[Order Cards]:
  - Item name + emoji
  - Date + Time: "Mon, 19 May at 2:30 PM"
  - Status badge (Delivered/Cancelled/Active)
  - Delivery duration: "Delivered in 8 min"
  - AI instruction text
  - Re-order button
```

---

## 10. Settings Screen (/settings)

```
[Profile Card] -- Name, Email, Role, Sign Out
[Work Shift] -- Morning / Night toggle
[Tea & Coffee Reminders]:
  - Enable/disable toggle
  - Interval (1-4 hours)
  - Preferred drink
[Push Notifications]:
  - Enable/disable toggle
  - Browser permission status
[AI Personality Tone]:
  - Professional / Friendly / Funny / Mom Mode / Minimal
[Security Info] -- Microsoft Authenticator status
[Privacy Note]
```

---

## 11. Admin Screens

### Dashboard (/dashboard) — FM, Finance, Leadership
- Today's order count, popular items, active orders
- Revenue tracking, category breakdown

### Daily Update (/daily-update) — FM, Leadership
- Set stock levels for the day
- Mark items available/unavailable

### Finance (/finance) — Finance, Leadership
- Vendor payment tracking
- Monthly expense reports

### Bill Upload (/bills) — Office Boy, FM, Leadership, Finance
- Upload vendor bills with photos
- Bill metadata: vendor, amount, date, category

### Bill Approval (/bills/approve) — Leadership, Finance
- Review uploaded bills
- Approve / Reject with notes

### Admin Panel (/admin) — Leadership only
- User management
- System configuration

### Insights (/reports) — Leadership only
- Audit log of all actions
- Usage analytics

---

## 12. Database Schema

### Core Tables

```sql
-- User profiles (synced from auth.users)
profiles:
  id (UUID, PK), email, full_name, preferred_name, role, avatar_url

-- Cafeteria menu items
cafeteria_items:
  id (UUID, PK), item_name, display_name, category,
  emoji, description, price, orderable (bool),
  stock_today (int), stock_servings (int),
  dependencies (JSONB array), sides_option (text),
  tags (JSONB array)

-- Orders / requests
requests:
  id (UUID, PK), raw_text, category, parsed_item,
  parsed_employee_name, parsed_location, instruction,
  submitted_by (FK profiles), status, live_status,
  notes, priority, rating, feedback,
  accepted_at, started_at, on_the_way_at,
  fulfilled_by, fulfilled_at, cancelled_at,
  created_at

-- User preferences
employee_cafeteria_preferences:
  id (UUID, PK), user_id (FK profiles),
  preferred_name, preferred_location,
  drink_prefs (JSONB), snack_prefs (JSONB),
  taste_prefs (JSONB), item_prefs (JSONB),
  shift, notification_tone, gender,
  reminder_enabled, reminder_time, reminder_days,
  onboarding_completed, floor_desk

-- Meal bookings
meal_bookings:
  id (UUID, PK), user_id, meal_date, choice,
  booked_at, cancelled_at

-- Push subscriptions
push_subscriptions:
  id (UUID, PK), user_id, endpoint, p256dh, auth
```

---

## 13. API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | /api/requests | Create order (quick or AI-parsed) | Any |
| GET | /api/requests | List orders | Any (filtered by role) |
| GET | /api/requests/:id | Get single order | Owner or staff |
| PATCH | /api/requests/:id/status | Update order status | Office Boy/FM/Leadership |
| POST | /api/requests/:id/cancel | Self-cancel within 30s | Owner only |
| POST | /api/requests/:id/rate | Rate delivered order | Owner only |
| GET | /api/requests/queue-count | Active order count | Any |
| GET | /api/cafeteria/items | List menu items | Any |
| PATCH | /api/cafeteria/items/:id | Update item stock/info | FM/Leadership |
| POST | /api/meals/book | Book meal | Any |
| GET | /api/meals/my | My meal bookings | Any |
| POST | /api/push/subscribe | Subscribe to push | Any |
| POST | /api/push/unsubscribe | Unsubscribe | Any |

---

## 14. AI System Prompt (GPT-4o-mini)

Used for natural language order parsing (free-text input):

**Role:** Applywizz Office Concierge AI  
**Tone:** Witty, energetic, Gen-Z friendly (like Zomato notifications)

**Extracts:** employee_name, request_type, item, quantity, location, priority, instruction (witty message for office boy), missing_details, follow_up_question

**Rules:**
- Process ALL clear requests immediately (never ask follow-up for known items)
- Only ask follow-up if item is completely unidentifiable
- Generate witty, emoji-filled instructions for the office boy
- Default quantity = 1, location = null if not stated

---

## 15. Notification Tones

Each tone changes OOS messages, low stock messages, dependency errors, and AI personality:

| Tone | Example OOS | Target |
|------|-------------|--------|
| Gen-Z | "Bruh it's gone 💀" | Default for young office |
| Friendly | "Oops, all gone for today! 😊" | General |
| Professional | "Currently unavailable" | Formal users |
| Funny | "Sorry beta, khatam ho gaya 🥺" | Hinglish humor |
| Mom Mode | "Beta, ye aaj khatam ho gaya 🥺💝" | Warm & caring |
| Boyfriend | "Hey cutie, this one's all gone 🥺💕" | Female users opt-in |
| Girlfriend | "Hey handsome, khatam ho gaya 🥺💕" | Male users opt-in |

---

## 16. Snack Strategy

### Current Items
| Item | Type | How It Works |
|------|------|-------------|
| Bread + Jam | Composite | Jam item + Bread dependency (2 slices per serving) |
| Bread + PB | Composite | PB item + Bread dependency (2 slices per serving) |
| Biscuits | Direct | Simple order, no dependencies |
| Banana | Direct | Simple order, no dependencies |

### Recommended Additions
| Item | Category | Notes |
|------|----------|-------|
| Maggi Noodles | Snack | Single serve pack, popular office snack |
| Marie Gold Biscuits | Snack | Separate from generic "Biscuits" |
| Dry Fruits Mix | Snack | Small pack, healthy option |
| Namkeen/Mixture | Snack | Traditional office munchies |

### Bread System (Slice-Based)
- All bread types consolidated into one "Bread" dependency item
- Each loaf (350g+) = 14 slices
- stock_today = number of loaves, stock_servings = total slices
- Jam/PB orders deduct slices from Bread
- One side = 1 slice, Both sides = 2 slices

---

## 17. Pending Features

### Lock Screen (15-min Inactivity)
- After 15 minutes of no interaction, show lock overlay
- User taps "Unlock" and re-enters TOTP code
- Session stays active (no re-login needed)

### Calorie Information
- Add `calories` column to cafeteria_items
- Display on item chip as subtle text
- CCD beverages: ~80-150 cal per cup
- Research exact values per CCD menu item

### Order History Redesign (Zomato/Swiggy Style)
- Larger cards with delivery duration
- "Delivered in 8 min" badge
- Re-order with one tap
- Rating stars inline

---

## 18. Environment Variables

### Frontend (.env)
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
VITE_API_BASE_URL=https://your-backend.onrender.com
VITE_VAPID_PUBLIC_KEY=xxx
```

### Backend (.env)
```
PORT=4000
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
OPENAI_API_KEY=xxx
VAPID_PUBLIC_KEY=xxx
VAPID_PRIVATE_KEY=xxx
ALLOWED_ORIGINS=https://your-frontend.vercel.app
POWER_AUTOMATE_URL=https://xxx (Teams webhook)
```

---

## 19. Deployment

| Service | Platform | Auto-Deploy |
|---------|----------|-------------|
| Frontend | Vercel | Yes, on git push to main |
| Backend | Render | Yes, on git push to main |
| Database | Supabase | Managed |
| Push | Render (same as backend) | Yes |

---

*End of PRD v2.0*
