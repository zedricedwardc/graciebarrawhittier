/**
 * cleanup-targets — declarative list of GHL items to delete.
 *
 * HOW TO USE:
 *   1. Set a value to `true` for items you want to delete.
 *   2. Leave `false` to keep.
 *   3. Run: `npx tsx scripts/cleanup-ghl.ts`          ← dry run (shows what WOULD happen)
 *   4. Run: `npx tsx scripts/cleanup-ghl.ts --execute` ← actually deletes
 *
 * Note on deletability:
 *   - contactCustomFields, customValues, pipelines, tags, forms, calendars → DELETE via API
 *   - workflows → GHL has NO public delete API. The script will emit a manual
 *     UI-deletion checklist for any workflows you mark `true`.
 *
 * Pre-populated from the 2026-05-11 inventory audit. Names must match GHL EXACTLY
 * (case- and whitespace-sensitive) — the executor matches by name, not by ID.
 */

// ─── 1. Contact Custom Fields (orphans from old snapshots) ──────────────────
//      All 21 are debris from Home Services / Academy Launch / Old Mark snapshots.
//      None are referenced by current src/ code. Sample of 100 contacts showed
//      ZERO populated values (likely safe).
export const contactCustomFields: Record<string, boolean> = {
  'Business Name': true,
  'Choose A Program': true,
  'Current Problem': true,
  'Did they Re-Boook?': true,
  'Did they show up in class?': true,
  'Discount Code': true,
  'Existing Website/No Website': true,
  'I’m Interested In:': true, // curly apostrophe in GHL — match exactly
  'Meeting Notes': true,
  'Message': true,
  'Multi Line 6jpj': true,
  'Niche/Industry ': true, // note trailing space in live GHL
  'Program Interest': true,
  'Query': true,
  'Timeline for completion of work': true,
  'Website Url': true,
  'What is the size of your home?': true,
  'What Program(s) Are Your Interested In? (Choose All That Apply)': true,
  'Where are you in the planning process?': true,
  'Where did you hear about us?': true,
  'Your Message': true,
};

// ─── 2. Custom Values ───────────────────────────────────────────────────────
//      Split into two implicit groups: blank template debris (recommend delete)
//      and GBW operational data (recommend keep). Marked accordingly.

export const customValues: Record<string, boolean> = {
  // --- blank template debris (recommended for deletion) ---
  '{{agency.email}}': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: A) Discount Offer Name': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: B) Discount Amount': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: C) City/Area/Market Name': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: D) Business Logo': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: E) Agency Name': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: F) Agency Email': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: G) Booking Calendar Link': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: H) Discount Funnel Link': true,
  '🥋 Brazilian Jiu Jitsu Snapshot Template: I) SS Phone Number': true,
  'Basic Black': true,
  'Booking Thank You Page': true,
  'Claim Thank You Page': true,
  'DR Offer': true,
  'Gray Text': true,
  'Holiday Special 2022': true,
  'Image 1': true,
  'Image 2': true,
  'Image 3': true,
  'Light Gray BG': true,
  'Light Gray Text': true,
  'Lime Green': true,
  'Niche Business': true,
  'Notifications Email For Client': true,
  'White': true,

  // --- GBW operational data (recommended to KEEP) ---
  'Academy Name': true,
  'Bit.ly Review link': true,
  'Bonus': true,
  'Brand Kit: Darkest Background': true,
  'Discount': true,
  'Email to Send Leads from': true,
  'Email to Send Leads to': true,
  'From Email': true,
  'Google Review Bitly ': true, // trailing space in live
  'Hiro Bot Name': true,
  'Kickstart Page': true,
  'Live Agent SOP': true,
  'Logo Image URL': true,
  'Martial Arts Style': true,
  'Offer Name': true,
  'Offer Price': true,
  'Owner Name': true,
  'Phone number to text leads to': true,
  'Primary Color ': true, // trailing space in live
  'Program Director Name': true,
  'Public Phone Number ': true, // trailing space in live
  'Re-Start Offer': true,
  'Sales Person Title': true,
  'Service 1': true,
  'Social Media (Facebook)': true,
  'Social Media (Instagram) ': true, // trailing space
  'Social Media (Twitter)': true,
  'Twilio Number': true,
  'Twilio Number In link Form': true,
  'Your App Login URL': true,
};

// ─── 3. Pipelines ───────────────────────────────────────────────────────────
//      ⚠️ Deleting a pipeline orphans every opportunity inside it. The audit found
//      large counts of LIVE opps in several pipelines:
//        Academy Launch Pipeline:   3,326 opps  ← real CRM history
//        Night King Pipeline:       1,457 opps  ← cold-lead history
//        Home Services Pipeline:      815 opps  ← wrong niche, investigate first
//        The Ultimate Jiu-Jitsu Trial: 223 opps
//      Empty pipelines (0 opps): 30 Day Jiu-Jitsu Challenge, Sales Pipeline (Editable)
export const pipelines: Record<string, boolean> = {
  '30 Day Jiu-Jitsu Challenge': false,           // 0 opps — safe
  'Sales Pipeline (Editable)': false,            // 0 opps — safe
  'The Ultimate Jiu-Jitsu Trial': false,         // 223 opps in "New Lead"
  'Night King Pipeline': false,                  // 1,457 opps — destructive
  'Academy Launch Pipeline': false,              // 3,326 opps — VERY destructive
  '🔨 Home Services New Customer Pipeline': false, // 815 opps — wrong niche
};

// ─── 4. Tags ────────────────────────────────────────────────────────────────
//      Pre-marked as recommend-delete based on the analysis. Flip true to confirm.
export const tags: Record<string, boolean> = {
  // Academy Launch lifecycle tags (replaced by new pipeline stages)
  '[appointment booked]': true,
  '[appointment showed]': true,
  '[hot lead] stage 1: 1a academy launch': true,
  '[hot lead] stage 1: 1b academy launch': true,

  // Night King / cold-outreach campaign tags
  'night king b1': true,
  'appointment booked | nk reactivation': true,
  'start cold email': true,
  'start cold sms': true,
  'start whatsapp blitz': true,
  'start ultimate outreach': true,
  'send voicemail': true,

  // Old campaign / offer tags
  'dr': true,
  'dr campaign': true,
  'crazy discount': true,
  'lead - ultimate trial': true,

  // System / state debris
  'alert use': true,           // typo dupe of "alert user" — recommend delete
  'workflow test': true,
  'fallback_reached': true,
  'pending gap message': true,
  'pending-gmb-reply': true,
  'replied gmb': true,
  'job done': true,

  // Duplicate variants (one of each pair — verify which is in use)
  'mm-website-leads': true,    // dupe of 'mm-website-lead'

  // Possibly keep — flagging for explicit review
  'spam': true,
  'don\'t include': true,
};

// ─── 5. Forms ───────────────────────────────────────────────────────────────
//      ⚠️ GHL has no public DELETE for forms — will emit UI-deletion checklist.
export const forms: Record<string, boolean> = {
  'Plumber form': false,        // wrong niche — Home Services debris
  'AISW Lead Form': false,      // unknown origin, investigate
  'Website Pop-Up Form': false, // verify if still used
  'Gracie Barra Whittier Form': false, // ⚠️ probably the active intake form — DO NOT delete unless verified
};

// ─── 6. Workflows ───────────────────────────────────────────────────────────
//      ⚠️ GHL has NO public delete API for workflows. The executor will emit
//      a manual UI-deletion checklist for anything marked true.
//      Pre-categorized by likely safety to delete.
export const workflows: Record<string, boolean> = {
  // -- DRAFT workflows (not firing) — safest to delete ----------------------
  '(2.0) Recipe - Appointment Confirmation + Reminder': false,
  '(2.0) Stage 1: Academy Launch Hot Lead': false,
  '1A Student Intent Chat (For Inbound Chat Requests) Workflow OM': false,
  '1A. Academy Launch NEW STUDENT INTENTION CAMPAIGN': false,
  '1B Academy Launch Hot Lead Campaign 30-60 day campaign OM': false,
  '1B. Academy Launch\n\nSTART YOUR TRIAL CAMPAIGN\n\n(14 Day Campaign)': false,
  '1B. Academy Launch START YOUR CHALLENGE CAMPAIGN ': false,
  '1B. Academy Launch START YOUR TRIAL CAMPAIGN (14 Day Campaign) ': false,
  '1C Nurture Campaign': false,
  '1C Nurture Campaign ': false,
  '2A Academy Launch Appointment Confirmation Campaign': false,
  '2A Appointment Confirmation Campaign': false,
  '2A Appointment Confirmation Campaign ': false,
  '2B Academy Launch Trial Student Campaign': false,
  '2B Trial Campaign': false,
  '2C Academy Re-Booking Campaign Workflow': false,
  '2C Re-booking Campaign': false,
  '2C Re-booking Campaign ': false,
  '30 Day Jiu-Jitsu Challenge': false,
  '3A New Student Review Campaign': false,
  '3A New Student Review Campaign ': false,
  '3B 2nd Trial Campaign': false,
  '3B 2nd Trial Campaign ': false,
  '4A Academy Launch Lead Re-activation campaign -OM': false,
  '4A LEAD RE-ACTIVATION CAMPAIGN': false,
  '4B Academy Launch Student Restart campaign -OM': false,
  'Academy Launch 2.0 - Appointment Booking': false,
  'Appointment Booked- has Tag "hot Lead" - OM': false,
  'Appointment No Show- General FB Form& Web form -OM': false,
  'Appointment Showed (General FB Form & Web Form)- OM': false,
  'Appointment Showed Old Students - OM': false,
  'Appointment Showed Prospect Workflow- OM': false,
  'Cold Outreach - 4 Email Drip Sequence': false,
  'Cold Outreach - 4 SMS Drip Sequence': false,
  'Cold Outreach - Voicemail Drop': false,
  'Customer Replied to FB Messenger Workflow- OM': false,
  'Customer Replied to GMB message workflow -OM': false,
  'Customer Replied to Website chat workflow- OM': false,
  'Did not Enroll': false,
  'Enroll to New Student': false,
  'FB Lead Form- New Lead- OM': false,
  'FB Messenger Workflow- OM': false,
  'GMB message Workflow- OM': false,
  'New Workflow : 1620090422358': false,
  'New Workflow : 1629244104270': false,
  'New Workflow : 1679506696737': false,
  'New Workflow : 1756513783427': false,
  'New Workflow : AI Test Workflow': false,
  'Night King Reactivation Campaign - copy': false,
  'Old Lead Database - OM': false,
  'Old Lead Database Booked Appointment Workflow -OM': false,
  'Old Student Booked Appointment Workflow- OM': false,
  'Old Student Database - OM': false,
  'Re-booking Workflow -OM': false,
  'Recipe - Appointment Booking': false,
  'Replied to 1C Academy Launch Nurture Campaign': false,
  'Review Request GMB': false,
  'Send Review': false,
  'SNAPSHOT MINDMAP': false,
  'test AI': false,
  'Ultimate Multi-Channel Outreach': false,
  'Website Chat Workflow- OM': false,
  'Website Form Appointment Showed - OM': false,
  'Website Form Submission (New Lead) -OM': false,
  'WhatsApp Cold Outreach Blitz': false,
  'Workflow- 1C Academy Launch Nurture Campaign (Forever Campaign) - OM': false,
  'Workflow- 3A Academy Launch New Student Review Campaign 5 day campaign -OM': false,
  'Workflow- 3B Academy Launch 2nd Trial Booking Campaign (Stale Opportunity) OM': false,

  // -- PUBLISHED workflows — ⚠️ currently RUNNING on contacts -------------
  // -- Verify intended replacement before deleting --
  ' GMB Business Message': false,
  '**EDIT USER** Appt Confirmation + Reminder': false,
  '**EDIT USER** Auto Missed Call Text-Back': false,
  '1. Night King Reactivation Campaign': false,
  '1.a: *EDIT* New Lead ': false,
  '1C. Academy Launch\n\nNURTURE CAMPAIGN': false,
  '2A. Academy Launch APPOINTMENT CONFIRMATION CAMPAIGN': false,
  '2B. Academy Launch 30 DAY CHALLENGE CAMPAIGN': false,
  '2B. Academy Launch General/Generic Campaign': false,
  '2C. Academy Launch RE-BOOKING CAMPAIGN': false,
  '3A. Academy Launch\n\nNEW STUDENT REVIEW CAMPAIGN': false,
  '3B. Academy Launch  2ND 30 DAY CHALLENGE CAMPAIGN': false,
  'ai outreach workflow': false,
  'Alert user': false,
  'Appointment Booked + Tag': false,
  'Birthday Template ($100 Discount)': false,
  'Database Reactivation: Discount Offer': false,
  'Follow-Up (Did Not Close Sale)': false,
  'Form Submission Onboarding': false,
  'GoogleMyBusiness: MIssed Call Text-Back': false,
  'If Appt Canceled Remove From Appt Reminders Workflow': false,
  'Live Agent': false,
  'New Lead Nurture': false,
  'Night King Reactivation Campaign': false,
  'No-Show Reactivation': false,
  'Recipe - Appointment Confirmation + Reminder': false,
  'Recipe - Review Request': false,
  'Recipe - Send Review Request': false,
  'Stage 4: Trial Member': false,
  'Website Form': false,
};
