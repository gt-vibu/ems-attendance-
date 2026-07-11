# Master AI Implementation Prompt
## Perimeter — Enterprise Attendance Verification Engine (v1.1)

---

## 1. Context & Master Instructions

You are a Senior Staff Engineer building **Perimeter**, a high-fidelity, enterprise-grade Attendance Verification Engine. Before writing any code, read the following specification files carefully:
- `perimeter-attendance-backend-spec.md` (Domain state machines, data schema, invariants, and database architecture)
- `perimeter-attendance-frontend-spec.md` (Time-seeded theme engine, responsive layout guidelines, camera liveness challenges, and timeline ribbon designs)

### 🚨 Critical Directives
- **Zero Placeholder Code**: Implement complete, robust, type-safe code. Never write `// TODO`, `// Implement later`, or empty return statements.
- **Strict Architecture Boundaries**: Keep domain state transitions, schema-driven validation, and UI layout logic completely separate.
- **Type-Safety First**: Do not use `any` types. Declare explicit interfaces and enums for all state models, event structures, and API contracts.

---

## 2. Directory Structure & Tech Stack

Implement a modular, single-workspace structure using the following stack:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 + Framer Motion.
- **Icons**: Imported exclusively from `lucide-react`. Do not write custom SVGs.
- **State Management**: React Context, simple State Hooks, or lightweight local state stores.

```text
/src
  /components
    /landing          # Landing Page Components (Hero Core, Floating Nav, Features, Demo)
    /dashboard        # Dashboard Components (Camera, Timeline, Approvals, Reconciliation, Stepper)
    /shared           # Shared Layouts, Badges, and Theme Providers
  /hooks              # Custom Hooks (useLiveTheme, useLivenessChallenge, useAttendanceState)
  /data               # Predefined Mock Data, Industry Templates, and Default Policies
  /types              # Shared TypeScript Interfaces, Enums, and Constants
  App.tsx             # Main Routing and Active View Manager
  index.css           # Global Theme Styles and Tailwind Imports
  main.tsx            # React Entry Point
```

---

## 3. Micro-Task Implementation Phases

To ensure robust code generation without hitting AI token or context limits, implement this system in the following five discrete phases:

### Phase 1: Foundations & Theming
- **Task 1.1: Shared Types & Enums (`/src/types/index.ts`)**
  - Implement all TypeScript interfaces representing: `Tenant`, `User`, `AttendanceSession`, `BreakRecord`, `PresenceGap`, `Anomaly`, `Policy`, and `CorrectionRequest`.
  - Declare standard state machine enums: `SessionStatus`, `BreakStatus`, `PresenceStatus`, `CorrectionStatus`, and `AnomalySeverity`.
- **Task 1.2: Time-Seeded Theme Hook (`/src/hooks/useLiveTheme.ts`)**
  - Implement a React hook that calculates time-of-day phases (Dawn, Day, Dusk, Night) based on the real current time.
  - Compute a deterministic "daily accent color" seeded from the calendar date, selecting from an elegant palette ring.
  - Return classes and inline CSS variable declarations for mesh gradients and text contrast.

### Phase 2: Public Landing Page
- **Task 2.1: Floating levitating Pill Nav (`/src/components/landing/FloatingNav.tsx`)**
  - Build a pill-shaped header component with slow sine-wave bobbing (2px vertical amplitude) using Framer Motion.
  - Implement magnetic hover states on links and smooth scroll-triggered condensation.
- **Task 2.2: The 3D Verification Core (`/src/components/landing/VerificationCore.tsx`)**
  - Render an abstract geometric container with concentric, overlapping rings (Policy, Geofence, Device, Biometrics).
  - Animate the rings rotating on entry and lining up into lock position on viewport entry.
- **Task 2.3: Interactive Confidence Sandbox (`/src/components/landing/ConfidenceSandbox.tsx`)**
  - Build a showcase widget with a "Simulate Check-In" action.
  - Stagger-animate progress bars filling in sequence: Biometric (98.4%), GPS boundary, Device Trust, and Network.
  - Fuse these values into a circular center display with an elegant glow representing the finished score.

### Phase 3: Employee Dashboard & Biometrics
- **Task 3.1: Simulated Camera & Liveness Challenge (`/src/components/dashboard/CameraChallenge.tsx`)**
  - Build a webcam viewport layout that prompts active liveness challenges (e.g., "Blink twice", "Turn your head left", "Smile").
  - Animate feedback cues, grid-node overlays, and challenge-success rings.
  - Update user state to `ACTIVE` upon successful challenge completion.
- **Task 3.2: Presence Timeline Ribbon (`/src/components/dashboard/TimelineRibbon.tsx`)**
  - Render a horizontal, continuous workday ribbon divided into custom-colored status bands (Geofence Present, Break, GPS Disabled, Out of Office).
  - Implement a hover scrubber showing timestamps and event labels at the cursor's location.

### Phase 4: Management & Reconciliation Views
- **Task 4.1: Break Reconciliation Split-Timeline (`/src/components/dashboard/BreakReconciliation.tsx`)**
  - Design a dual horizontal timeline showing: Track A (User Declared Breaks) and Track B (Observed Presence Gaps).
  - Highlight discrepancies visually and render buttons to resolve, approve, or flag discrepancies as anomalies.
- **Task 4.2: Correction Stepper & Diff Panel (`/src/components/dashboard/CorrectionRequest.tsx`)**
  - Build an interactive timeline stepper: `Draft → Submitted → Manager Approved → HR Approved → Applied`.
  - Create an side-by-side Diff drawer comparing old vs. new values for corrected timestamps.

### Phase 5: AI Policy Builder
- **Task 5.1: Natural Language Policy Editor (`/src/components/dashboard/PolicyBuilder.tsx`)**
  - Implement a split-pane layout.
  - Left pane: Interactive input console supporting click-to-load template prompts (Grace Period, Break Threshold, GPS Rules).
  - Right pane: Real-time generated JSON ruleset preview, explaining dynamic triggers and severity levels.
