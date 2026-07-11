# Perimeter — Enterprise Attendance Verification Engine
## Master Backend Specification (v1.1)

---

## 1. Executive Summary & Core Philosophy

Perimeter is an enterprise-grade Identity, Presence, and Attendance Verification Engine designed for workforce coordination. Unlike traditional HRMS platforms that treat attendance as a binary check-in/check-out timestamp, Perimeter operates as a multi-signal verification engine that evaluates live biometrics, geofencing coordinates, device trust metrics, and tenant policies to generate a continuous **Attendance Confidence Score**.

### Core Architecture Principles
- **Zero-Trust Presence**: Attendance is not "recorded and forgotten." Presence is monitored via low-overhead passive signals (GPS boundary crossings, network check-ins) and reconciled against user-declared states.
- **Strict Multi-Tenancy**: Complete tenant isolation at the row level via `tenant_id` tenant resolvers.
- **Immutable Audit Trails**: Every transition of an attendance session, break, or correction request is captured as an immutable event-outbox record.
- **Dynamic Policy Rules**: No hardcoded shifts or validation thresholds. The platform runs a dynamic condition-action rule engine loaded at runtime.

---

## 2. Core Domain Modules

### 2.1 Attendance Session Engine
Tracks daily work sessions. Combines check-in verification events, break tracking, and check-out rules to compute accurate work hours, overtime, and early exits.
- **Check-In Validation Pipeline**: Chains multiple validators (GPS, Face Biometrics, Device, Network) through a Chain of Responsibility pattern.
- **Grace Period Calculation**: Computes exact lateness and early departures relative to dynamic schedules.

### 2.2 Presence Verification Engine
Independently monitors employee location. It logs Office Entry, Office Exit, and GPS Unknown events.
- **GPS Gap Detection**: Identifies when GPS tracking is disabled and triggers warning escalations or review holds.
- **Timeline Aggregator**: Merges GPS and network events into a scrubbable horizontal presence timeline.

### 2.3 Break Engine & Reconciliation
Tracks break start/end times using server-side timestamps. 
- **Reconciliation Module**: Compares user-declared breaks with observed presence gaps. On divergence, highlights discrepancies (e.g., employee declares a 15-minute break but presence telemetry shows they were outside the geofence for 60 minutes) and raises an anomaly.

### 2.4 Biometrics & Face Verification Engine
Generates and compares facial embeddings (512-dimensional vectors) using pre-trained models.
- **Enrollment KYC**: One-time enrollment requiring multi-angle captures (front, left, right, smile, blink) to generate an averaged encrypted face embedding.
- **Active Liveness Challenges**: Generates a randomized challenge sequence (e.g., "blink, then turn head left") at check-in to prevent print, screen, or deepfake replays.

### 2.5 Policy & Rule Engine
Loads active tenant policies on demand and evaluates them against employee actions.
- **AI Policy Builder**: Translates natural-language commands (e.g., "Manger gets notified if employees take more than 45 minutes of break") into structured JSON rule trees.
- **Policy Versioning**: Pins the exact policy version active at the moment of session check-in, preventing retroactive policy changes from altering historical session evaluations.

---

## 3. Database Schema Blueprint (Prisma)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id        String   @id @default(uuid())
  name      String
  industry  String
  createdAt DateTime @default(now())
  policies  Policy[]
  users     User[]
}

model User {
  id              String           @id @default(uuid())
  tenantId        String
  email           String           @unique
  role            String           // "ADMIN", "MANAGER", "EMPLOYEE"
  name            String
  faceEmbedding   Float[]          // Encrypted 512-d embedding
  tenant          Tenant           @relation(fields: [tenantId], references: [id])
  sessions        AttendanceSession[]
  corrections     CorrectionRequest[]
}

model Policy {
  id             String          @id @default(uuid())
  tenantId       String
  version        Int
  isActive       Boolean         @default(false)
  effectiveFrom  DateTime        @default(now())
  rules          Json            // Structured rule tree
  tenant         Tenant          @relation(fields: [tenantId], references: [id])
  sessions       AttendanceSession[]
}

model AttendanceSession {
  id              String          @id @default(uuid())
  tenantId        String
  userId          String
  policyId        String
  status          String          // NOT_STARTED, ACTIVE, ON_BREAK, NEEDS_REVIEW, CLOSED, ABSENT
  checkedInAt     DateTime?
  checkedOutAt    DateTime?
  confidenceScore Float           @default(1.0)
  user            User            @relation(fields: [userId], references: [id])
  policy          Policy          @relation(fields: [policyId], references: [id])
  breaks          BreakRecord[]
  presenceGaps    PresenceGap[]
  anomalies       AttendanceAnomaly[]
}

model BreakRecord {
  id          String            @id @default(uuid())
  sessionId   String
  status      String            // REQUESTED, ACTIVE, ENDED, RECONCILED
  startedAt   DateTime
  endedAt     DateTime?
  forced      Boolean           @default(false)
  session     AttendanceSession @relation(fields: [sessionId], references: [id])
}

model PresenceGap {
  id          String            @id @default(uuid())
  sessionId   String
  type        String            // EXIT, GPS_DISABLED
  openedAt    DateTime
  closedAt    DateTime?
  durationSec Int?
  session     AttendanceSession @relation(fields: [sessionId], references: [id])
}

model AttendanceAnomaly {
  id          String            @id @default(uuid())
  sessionId   String
  type        String            // RECONCILIATION_MISMATCH, GPS_GAP, DEVICE_MISMATH
  severity    String            // LOW, MEDIUM, HIGH, CRITICAL
  resolved    Boolean           @default(false)
  session     AttendanceSession @relation(fields: [sessionId], references: [id])
}

model CorrectionRequest {
  id          String            @id @default(uuid())
  tenantId    String
  userId      String
  status      String            // DRAFT, SUBMITTED, MANAGER_APPROVED, APPLIED, WITHDRAWN
  preSnapshot Json
  postChanges Json
  user        User              @relation(fields: [userId], references: [id])
}
```

---

## 4. Attendance Lifecycle & State Machines

### 4.1 Attendance Session State Machine
Controls the top-level daily workflow of an employee's attendance.

```
NOT_STARTED ──check_in_submitted──▶ PENDING_VERIFICATION
PENDING_VERIFICATION ──pipeline_passed──▶ ACTIVE
    / side effect: Initializes presence tracking (4.3); computes Present/Late
PENDING_VERIFICATION ──pipeline_failed [terminal]──▶ REJECTED
    / side effect: Logs to fraud engine if failure is spoof or unauthorized device
PENDING_VERIFICATION ──pipeline_failed [recoverable]──▶ NOT_STARTED
ACTIVE ──break_started──▶ ON_BREAK
    / guard: Daily break counts & policy limits not exceeded
ON_BREAK ──break_ended──▶ ACTIVE
    / side effect: Runs reconciliation checks against passive presence gaps
ACTIVE ──presence_gap_unresolved_at_checkout──▶ NEEDS_REVIEW
ACTIVE ──check_out_submitted [confidence ≥ threshold & no anomalies]──▶ CLOSED
    / side effect: Computes exact working hours & overtime pay adjustments
ACTIVE ──check_out_submitted [confidence < threshold OR has anomalies]──▶ NEEDS_REVIEW
    / side effect: Marks session pending manual administrator/manager review
ACTIVE ──auto_checkout_triggered [past cutoff time]──▶ NEEDS_REVIEW
NEEDS_REVIEW ──manager_approved──▶ CLOSED
NEEDS_REVIEW ──manager_flagged──▶ PENDING_APPROVAL
    / side effect: Generates structural correction request
PENDING_APPROVAL ──correction_finalized──▶ CLOSED
* ──end_of_day_sweep [no session, no approved leave/holiday]──▶ ABSENT
```

### 4.2 Break Session State Machine
Governs individual break tracking within a working session.

```
IDLE ──start_break_requested──▶ REQUESTED
REQUESTED ──approval_not_required──▶ ACTIVE
    / side effect: Sets startedAt to true server-time (never trusts client clocks)
REQUESTED ──approval_required──▶ PENDING_APPROVAL
PENDING_APPROVAL ──approved──▶ ACTIVE
PENDING_APPROVAL ──denied──▶ IDLE
ACTIVE ──end_break_requested──▶ ENDED
    / side effect: Records endedAt server time; calculates total break duration
ACTIVE ──grace_exceeded──▶ ACTIVE (self-transition)
    / guard: Exceeds break type grace threshold -> triggers warning push notification
ENDED ──reconciliation_run──▶ RECONCILED
    / side effect: Matches break timeline against presence exits; raises anomalies on mismatch
```

### 4.3 Presence Verification State Machine
Tracks absolute physical location passive streams, reporting entries, exits, and tracking health.

```
INSIDE_OFFICE ──geofence_exit_detected──▶ OUTSIDE_OFFICE
    / emits: presence.gap_opened (type=EXIT)
INSIDE_OFFICE ──gps_boundary_proximity──▶ NEAR_BOUNDARY
NEAR_BOUNDARY ──gps_moves_inward──▶ INSIDE_OFFICE
NEAR_BOUNDARY ──gps_moves_outward──▶ OUTSIDE_OFFICE
    / emits: presence.gap_opened
OUTSIDE_OFFICE ──geofence_reentry_detected──▶ INSIDE_OFFICE
    / emits: presence.gap_closed (type=ENTER) -> computes gap duration
INSIDE_OFFICE ──gps_disabled──▶ PRESENCE_UNKNOWN
OUTSIDE_OFFICE ──gps_disabled──▶ PRESENCE_UNKNOWN
    / emits: presence.gap_opened (type=GPS_DISABLED)
PRESENCE_UNKNOWN ──gps_enabled──▶ INSIDE_OFFICE | OUTSIDE_OFFICE
    / emits: presence.gap_closed -> assesses duration:
        - <10 min: Ignore
        - 10-30 min: Warn employee
        - >30 min: Mark session NEEDS_REVIEW and notify supervisor
```

### 4.4 Attendance Correction State Machine
Coordinates formal requests to edit finalized or disputed attendance logs.

```
DRAFT ──submitted──▶ SUBMITTED
    / side effect: Stores immutable pre-change snapshot (Audit trail)
SUBMITTED ──withdrawn──▶ WITHDRAWN
SUBMITTED ──manager_decision [approve, single-stage]──▶ APPLIED
    / side effect: Mutates original AttendanceSession; transitions session to CLOSED
SUBMITTED ──manager_decision [approve, dual-stage]──▶ MANAGER_APPROVED
SUBMITTED ──manager_decision [reject]──▶ MANAGER_REJECTED
MANAGER_APPROVED ──hr_decision [approve]──▶ APPLIED
    / side effect: Updates original session with post-change audit logs
MANAGER_APPROVED ──hr_decision [reject]──▶ HR_REJECTED
```

### 4.5 Policy Version Lifecycle State Machine
Handles system-wide policy changes, ensuring historical immutability.

```
DRAFT ──validation_passed──▶ VALIDATED
DRAFT ──validation_failed──▶ DRAFT (self-transition)
VALIDATED ──activated──▶ ACTIVE
    / guard: No other PolicyVersion is currently ACTIVE for this tenant
    / side effect: Automatically marks previous active version as SUPERSEDED
ACTIVE ──new_version_activated──▶ SUPERSEDED
SUPERSEDED ──retention_period_elapsed──▶ ARCHIVED
```

### 4.6 Approval Workflow State Machine (Generic)
A modular routing engine instantiated for corrections, device authorizations, or leaves.

```
PENDING ──assigned──▶ IN_REVIEW
    / side effect: Sends email and push notification to current approver node
IN_REVIEW ──approved [has next approver]──▶ PENDING
    / side effect: Resolves next node in approval chain
IN_REVIEW ──approved [is final approver]──▶ APPROVED
IN_REVIEW ──rejected──▶ REJECTED
IN_REVIEW ──sla_deadline_breached [escalate]──▶ ESCALATED
    / side effect: Reassigns item to the user's supervisor
IN_REVIEW ──sla_deadline_breached [expire]──▶ EXPIRED
    / side effect: Terminally rejects request by default
```

---

## 5. Domain Events & Transition Matrix

Every state transition produces a structured domain event written to an Outbox table in the same database transaction.

| Machine | State Transition | Emitted Event | Downstream Consumers |
|---|---|---|---|
| **Session** | `PENDING_VERIFICATION → ACTIVE` | `attendance.checked_in` | Real-time Manager Dashboard, Notification Engine |
| **Session** | `ACTIVE → CLOSED` | `attendance.checked_out` | Hours Accrual Engine, Overtime Rule Validator |
| **Session** | `* → NEEDS_REVIEW` | `attendance.anomaly_detected` | Anomaly Queue, Manager Review Panel |
| **Break** | `PENDING_APPROVAL → ACTIVE` | `break.started` | Presence Gap Checker, Break Accumulator |
| **Break** | `ACTIVE → ENDED` | `break.ended` | Reconciliation Engine, Compliance Logger |
| **Presence** | `INSIDE_OFFICE → OUTSIDE_OFFICE` | `presence.gap_opened` | Gap Duration Timer, Geofence Watchdog |
| **Correction** | `MANAGER_APPROVED → APPLIED` | `attendance.corrected` | Audit Ledger, Payroll Adjustment Queue |
