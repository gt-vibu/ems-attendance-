# Perimeter — Enterprise Attendance Verification Engine
## Master Frontend Design Brief & Specification (v1.1)

---

## 1. Design System & Visual Grammar

Perimeter uses a highly polished, light-themed, modern enterprise SaaS aesthetic with layered, glass-morphic depth, soft realistic elevations, and clean monospace indicators. It shares a unified color, spacing, and interaction language between the public landing page and the authenticated app console.

### 1.1 Color Palette & Time-Seeded Theme
The interface uses a **Time-Seeded Ambient Theme System** driven by a custom React hook `useLiveTheme()`.
- **Primary Canvas**: Elegant off-whites and ultra-soft grays (`#FAFAFC` to `#F3F4F6`).
- **Base Containers**: Pure glass `#FFFFFF` panels with soft border outlines (`rgba(0,0,0,0.04)`) and a delicate frosted backing blur (`backdrop-blur-md`).
- **Accent Ring**: Seeds a primary accent color dynamically from the calendar date (e.g., Monday = Emerald, Tuesday = Indigo, Wednesday = Violet, Thursday = Teal, Friday = Rose). This creates a deterministic, daily-rotating accent hue.
- **Time-of-Day Lighting**: Background mesh gradients transition smoothly between:
  - *Dawn* (06:00 - 09:00): Soft peach and pale gold.
  - *Day* (09:00 - 17:00): Clean crystal white and sky blue.
  - *Dusk* (17:00 - 20:00): Deep amber and soft lilac.
  - *Night* (20:00 - 06:00): Muted charcoal, slate blue, and platinum highlights.

### 1.2 Typography & Sizing
- **Headings**: `Space Grotesk` or clean sans-serif with narrow tracking (`tracking-tight font-medium`).
- **Body & Controls**: `Inter` sans-serif (`font-normal leading-relaxed text-slate-700`).
- **Status & Indicators**: `JetBrains Mono` or monospace (`text-xs uppercase text-slate-500 font-medium tracking-widest`).

### 1.3 Motion & Easing Curves
- All transitions must share a single bezier easing curve: `cubic-bezier(0.16, 1, 0.3, 1)` (Ultra Soft Out, 300-400ms duration).
- Ambient drifting elements (particles, mesh nodes) must slow down or pause on window blur or when `prefers-reduced-motion` is active.

---

## 2. Public Landing Page — Detailed UI Blueprint

The landing page is structured as a single continuous 3D-like viewport sectioned by soft scrolling indicators.

### 2.1 The Levitation Navigation Pill
- **Visuals**: A pill-shaped floating panel flying in on load via spring transition.
- **Aesthetics**: Floating continuously with a slow, slow sine wave bobbing effect (2px amplitude, 4s cycle). Condenses to icon-only controls on scroll.
- **Interactions**: Soft magnetic hover on links (Product, Security, Verification Engine, Pricing, App Access). Text pulls slightly toward the mouse, and a faint background spotlight glow traces cursor movement.

### 2.2 Hero Scene: The "Verification Core"
- **Central Element**: An elegant, rotating, layered 3D-like glass ring or orb.
- **Layers**: 4 nested rings representing:
  - *Outer Layer*: Policy Context (pins verification versioning).
  - *Second Layer*: Location/Geofencing (tracks boundaries).
  - *Third Layer*: Device Trust (validates registered hardware).
  - *Inner Core*: Facial Biometrics & Liveness.
- **Load Animation**: The 4 layers start scattered or rotated out of alignment on page entry, then slide and click into a concentric, rotating lock as the headline is revealed.
- **Headline**: "Attendance you can prove, not just record."
- **Subheadline**: "A multi-signal verification engine producing a high-fidelity confidence score instead of a binary guess."

### 2.3 Interactive "Confidence Score" Demo Widget
A live, interactive sandbox where visitors can see how Perimeter compiles a check-in confidence rating:
- **Button**: "Simulate Check-In".
- **Interaction**: Clicking triggers a sequence of cascading, detailed sub-scores:
  1. *Signal 1: Face Match*: Progress bar fills to `98.4%` (Liveness checks green).
  2. *Signal 2: GPS Boundary*: Geofence matches active Branch Office (Branch Name: "HQ East", GPS variance: ±3m).
  3. *Signal 3: Device Trust*: Checks device signature (Mac OS, App installation binding confirmed).
  4. *Signal 4: Corporate Network*: Wi-Fi MAC address matches active router logs.
- **Conclusion**: The four bars merge into a circular center widget that blooms with a soft, pulsing green glow: **Overall Confidence: 97.4% — Check-In Verified**.

### 2.4 Modular Feature Cards (Cursor Hover Tilt)
Each feature gets a cards with 3D hover tilt (using card container relative coordinates):
1. **Presence Timeline Ribbon**: An animated graphic depicting active office boundaries, showing a simulated walk outside and inside, with automatic anomaly detection.
2. **Break Reconciliation tracks**: Parallel visual paths (User Declared vs. Telemetry Detected) highlighting how forgotten checkouts or long breaks are flagged as friendly anomalies.
3. **AI Policy Builder console**: Showing an English input field, an animated progress loader, and the resulting JSON rule definition output.

---

## 3. Authenticated App Console — Detailed UI Blueprint

The application dashboard shares the visual style of the landing page but prioritizes data density, high-contrast tables, and immediate clarity.

### 3.1 Policy Version Header Bar
- **Location**: Top edge of the shell.
- **Visuals**: A slim, clean strip displaying: `ACTIVE POLICY: v2.4.1 (Effective: July 2026)`.
- **Interaction**: Clicking slides open a historical version drawer showing active, superseded, or pending drafts, clarifying exactly what rules are applied to historical timesheets.

### 3.2 Employee Home Dashboard

#### A. Interactive Check-In/Check-Out Camera Panel
- **Layout**: A frosted-glass card housing a live camera container (simulated or browser feed).
- **Liveness Challenge Simulation**: Instead of a simple snap, it runs active challenges:
  - *Challenge Box*: "Liveness Check: Blink twice."
  - *Action*: User blinks (simulated via an interactive button or camera event).
  - *Next Challenge*: "Liveness Check: Turn your head left."
  - *Success State*: The camera ring animates, showing biometric embeddings extracting (pulsing face grid nodes), culminating in confidence assembly.
- **Dynamic State Chips**: Large, beautifully animated state badges showing the active state machine status:
  - `ACTIVE`: Muted green badge with a slow breathing opacity pulse.
  - `ON_BREAK`: Amber badge with a slow, reassuring pause-icon blink.
  - `NEEDS_REVIEW`: Muted yellow shimmer (no red alarms - flags an anomaly for friendly supervisor review).
  - `PENDING_APPROVAL`: Muted blue dot-loader showing approval stages remaining.

#### B. The Presence Timeline Ribbon
- **Visuals**: A horizontal, continuous visual track representing a 12-hour workday.
- **Segments**: Color-banded strips:
  - *Emerald Block*: Present inside Geofence boundary.
  - *Sand/Amber Block*: Declared Break duration.
  - *Slate Block*: GPS Unreachable / Off.
  - *Muted Crimson Outline*: Unreconciled Absence (presence gap with no break declared).
- **Scrubber**: Interactive scrubber letting employees hover over segments to read exact times and triggers (e.g., "11:15 AM - Exited Geofence HQ").

### 3.3 Manager Approvals & Reconciliation Panel

#### A. Break Reconciliation View
- **Layout**: A split horizontal grid comparison.
- **Track 1**: "Employee Declared Breaks" (Timeline showing e.g., 12:00 PM to 12:30 PM).
- **Track 2**: "Observed Geofence Absences" (Timeline showing telemetry exit at 11:55 AM, return at 12:45 PM).
- **Anomalies**: A red bracket highlighting the discrepancy (20-minute gap difference). Includes an inline "Flag as Anomaly" or "Approve/Forgive" button with optional comments.

#### B. Approval Queue Cards
- **Aesthetics**: Floating cards showing a visual "Avatar Train" of the approval sequence (Manager A -> HR Partner -> Applied).
- **SLA Deadline Corner**: A thin, circular countdown loader in the card's top corner showing time remaining to approve before escalation occurs (e.g., "SLA: 12 Hours Remaining").

#### C. Correction Request Detail with Visual Stepper
- **Layout**: Clear horizontal node progress: `Draft → Submitted → Manager Approved → HR Approved → Applied`.
- **Node States**: Complete nodes light up with the daily date-seeded accent color; active nodes pulse; unreached nodes stay flat grey.
- **Side Drawer**: Slides in from the right to show the immutable pre-change and post-change snapshots side-by-side (diff layout).

### 3.4 Interactive AI Policy Builder
- **Visuals**: A spacious split-screen interface.
- **Left Panel**: A rich text console with placeholder: "Describe your attendance policy in plain English...".
- **Right Panel**: A real-time, interactive code inspector showing the generated JSON schema, complete with validation rules, triggers, and action pathways.
- **Demo Prompts**: Quick-clickable prompt tags:
  - *Late Grace*: "Give a 15 minute grace period for the morning shift. If more than 3 late check-ins in a week, send an email to the supervisor."
  - *Flexible Breaks*: "Allow two 15-minute paid breaks. Any break past 20 minutes should automatically be marked as unpaid."
  - *GPS Boundaries*: "Verify check-in only when within 50 meters of any registered branch coordinates."
