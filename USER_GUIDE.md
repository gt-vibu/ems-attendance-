# Smart Teams / AEMS — Complete Platform User Guide

Welcome to **Smart Teams / AEMS** (Attendance, Leave, Payroll, Field Verification, & Identity Platform). This document serves as the comprehensive user guide detailing all features, modules, workflows, and access controls available across all three user tiers: **Super Admin**, **Tenant Admin**, and **Employee / Manager**.

---

## 📌 Executive Summary & User Tier Overview

Smart Teams is designed around a zero-trust, cryptographically verified, and audit-proof architecture. Access and capabilities are strictly scoped across three distinct roles:

| Feature / Capability | ⚡ Super Admin | 🏢 Tenant Admin | 👤 Employee / Manager |
| :--- | :---: | :---: | :---: |
| **Multi-Tenant Management & Provisioning** | ✅ Full Access | ❌ No Access | ❌ No Access |
| **Tenant Feature Flags & Plan Caps** | ✅ Full Access | ❌ Read Only / Request | ❌ No Access |
| **Branch & Geofence Site Setup** | ✅ Global | ✅ Full Tenant | ❌ No Access |
| **Attendance Policy & Verification Rules** | ✅ Global | ✅ Full Tenant | ❌ No Access |
| **Role-Based Access Control (RBAC)** | ✅ Global | ✅ Full Tenant | ❌ No Access |
| **Employee Directory & Onboarding** | ✅ Global | ✅ Full Tenant | ❌ View Team Only |
| **Leave Policy & Multi-Tier Approvals** | ✅ Global | ✅ Full Tenant | 👤 Apply / Approve (Manager) |
| **Payroll Processing & Payslip Runs** | ✅ Global | ✅ Full Tenant | 👤 View Own Payslips |
| **Shift Swaps & Calendar Management** | ✅ Global | ✅ Full Tenant | 👤 Request & Swap |
| **Biometric & Passkey Registration** | ❌ System Level | ❌ Admin Level | ✅ Full Self-Service |
| **Clock-In / Clock-Out & Break Controls** | ❌ System Level | ❌ Admin Level | ✅ Full Self-Service |
| **Attendance Correction & Tickets** | ❌ System Level | 👤 Review/Approve | ✅ Submit & Track |
| **Audit Ledger & Compliance Trail** | ✅ Platform-wide | ✅ Tenant-wide | 👤 Self-Activity Log |

---

## ⚡ Tier 1: Super Admin User Guide

The **Super Admin** (`super_admin`) is the platform governance authority. Super Admins oversee system health, manage multi-tenant provisioning, assign platform licenses, and toggle feature capabilities for individual organization subscriptions.

### 1. Platform Command Center & Navigation
* **URL Route:** `/dashboard` (Platform Mode)
* **Key Function:** Real-time visibility into all onboarded tenant organizations, active employee seats, system usage stats, and infrastructure security metrics.

### 2. Tenant Management & Organization Provisioning
* **Key Operations:**
  * **Onboard New Tenant:** Register a new company, set company domain/slug, primary admin contact credentials, and default business timezone.
  * **Tenant Status Control:** Toggle tenant status between `Active`, `Suspended`, or `Trial`.
  * **Branch & Geo-Limits:** Configure baseline global branch constraints.

### 3. Subscription Plan & Feature Licensing (`/super/plan-features/:tenantId`)
Super Admins can granularly enable or disable modules and set limits per tenant:
* **Max Employee Cap:** Enforce seat limits according to subscription tiers (e.g., Free up to 10 employees, Pro up to 250, Enterprise unlimited).
* **Module Feature Flags:** Toggle key modules on/off per organization:
  * 👁️ **Biometric Face Recognition:** Enable server-side and on-device liveness face verification.
  * 🔑 **WebAuthn / Passkey Authentication:** Enable hardware security key & biometric FIDO2 logins.
  * 📍 **Geofence & Boundary Enforcement:** Require GPS proximity for check-ins.
  * 📱 **Dynamic QR Kiosk Check-In:** Enable wall-mounted kiosk dynamic QR codes for rapid team clock-in.
  * 💰 **Advanced Payroll & Automated Tax Engine:** Enable multi-currency, custom deductions, and overtime rules.
  * 🌴 **Automated Multi-Tier Leave Routing:** Enable workflow engines for multi-level manager/HR/GM approvals.
  * 🔄 **Shift Swaps & Peer Desk:** Allow employees to exchange assigned shifts.
  * 💵 **Leave Encashment:** Enable converting unused leave balances into monetary compensation during payroll.
  * 🌐 **WFH & Remote Clocking Eligibility:** Allow remote work clock-in privileges without geofence failure alerts.

---

## 🏢 Tier 2: Tenant Admin User Guide

The **Tenant Admin** (`tenant_admin`) operates as the Organization Administrator. Tenant Admins configure operational policies, set up branches, manage employee directories, define roles, process payroll, and oversee compliance.

### 1. Organization Overview & Executive Dashboard (`/dashboard`, `/tenant/admin`)
* **Real-time Metrics:** Live attendance headcounts, active clock-ins, on-break counts, late arrivals, absent staff, pending leave applications, and flag alerts.
* **Operational Feed:** High-level summary of daily work shifts and compliance risks across all organization branches.

### 2. Branch & Site Setup (`/tenant/branches`, `/tenant/branch-setup`)
* **Creating & Editing Branches:** Define office sites, factory locations, or client project sites.
* **Geofence Coordinates & Radius:** Specify precise GPS latitude, longitude, and allowed radius (in meters).
* **Kiosk & Device Binding:** Register authorized stationary terminal devices (tablets/laptops) for shared employee check-ins.
* **Work Schedules & Timezones:** Assign default operational shifts, office start times, and company timezones.

### 3. Attendance Preferences & Verification Policy (`/tenant/attendance-preferences`)
Configure how employees prove attendance across the organization:
* **Allowed Verification Methods:**
  * **Biometric Face ID:** Mandatory webcam face scan matching registered biometric vectors.
  * **Passkey / WebAuthn:** FIDO2 hardware/fingerprint device authentication.
  * **Dynamic QR Scan:** Mobile camera scan of auto-rotating kiosk QR screens.
  * **Geofenced GPS:** Location-bound check-ins.
  * **Manual / Supervisor Override:** Admin fallback for field exceptions.
* **Security & Threshold Settings:**
  * **Face Confidence Score:** Set required matching confidence (e.g., 85%+ match).
  * **Liveness Detection Toggle:** Require real-time eye blink / motion detection to prevent photo spoofing.
* **Shift Rules & Penalties:**
  * **Grace Period:** Define allowed tardiness buffer (e.g., 15 minutes grace).
  * **Half-Day & Overtime Thresholds:** Set minimum hours required for full day credit and threshold for overtime calculation.
  * **Auto-Checkout Rules:** Set end-of-day auto checkout timers for forgotten check-outs.

### 4. Employee Directory & Identity Management (`/tenant/directory`)
* **Employee Onboarding:** Add new team members with personal info, employee ID, department, manager, join date, and employment status.
* **Payroll & Compensation Setup:** Assign base salary, hourly rates, overtime multipliers, and payout bank details.
* **KYC & Biometric Status:** Monitor whether employees have completed face enrollment and passkey binding.

### 5. Role-Based Access Control (RBAC) (`/tenant/roles`)
* **Predefined & Custom Roles:** Create custom operational roles (e.g., HR Manager, Branch Supervisor, Finance Auditor, Shift Lead).
* **Granular Permission Matrix:** Assign specific privileges:
  * `attendance.view_all`, `attendance.override`
  * `leave.approve`, `leave.configure`
  * `payroll.run`, `payroll.export`
  * `team.manage`, `reports.export`
  * `audit.view`, `settings.manage`

### 6. Leave Management & Approval Routing (`/tenant/leave`, `/tenant/approval-routing`)
* **Leave Policy Engine:** Define custom leave types (Casual, Sick, Annual, Maternity, Paternity, Unpaid) with yearly quotas, carry-forward limits, and encashment settings.
* **Multi-Tier Routing Matrix:** Set multi-stage approval flows:
  * Step 1: Direct Reporting Manager
  * Step 2: Department Head / HR Manager
  * Step 3: General Manager / Tenant Admin
* **Desk Operations:** Approve, reject, or request information on pending employee leave applications with reason logs.

### 7. Automated Payroll Engine (`/tenant/payroll`, `/tenant/payroll/batches`, `/tenant/payroll/history/:userId`)
* **Salary Profile Wizard:** Set up structured earnings (Base Pay, HRA, Medical Allowance, Travel Allowance) and deductions (Taxes, Provident Fund, Insurance, Penalties).
* **Batch Payroll Run:** Execute automated monthly/bi-weekly payroll runs incorporating actual verified attendance hours, late deductions, approved overtime, and encashed leave.
* **Payslip Generation & Export:** Publish digital payslips directly to employee portals and export bank transfer files (CSV/PDF).

### 8. Teams, Delegation, & Organization Chart (`/tenant/teams`, `/tenant/delegation`, `/tenant/org-chart`)
* **Teams Workspace:** Group employees into functional units and assign team leaders.
* **Approval Delegation:** Temporarily transfer manager approval powers to a peer when a supervisor goes on extended leave.
* **Org Chart Visualizer:** View dynamic hierarchy tree of managers and direct reports.

### 9. Workspace Boundaries & Network Controls (`/tenant/workspace-boundaries`)
* **IP Whitelisting:** Restrict clock-ins to corporate Wi-Fi network public IP addresses.
* **Polygonal Geofencing:** Create complex polygon geofence perimeters for large industrial sites or multi-building campuses.

### 10. Audit Ledger & Compliance (`/tenant/audit-ledger`)
* **Cryptographic Tamper-Proof Logs:** Track every state transition, manual attendance edit, salary override, or role change with timestamp, IP address, and acting user ID.

### 11. Reports & Analytics Center (`/tenant/reports`)
* **Exportable Reports:** Download detailed CSV/PDF reports for:
  * Attendance & Tardiness Summary
  * Overtime Hours & Cost Breakdown
  * Leave Utilization & Balance Ledger
  * Payroll Distribution Reports
  * Audit Log Compliance Trails

---

## 👤 Tier 3: Employee & Manager User Guide

The **Employee Portal** (`employee`) is tailored for daily operational self-service. Employees use this workspace to clock in, track work hours, take breaks, view earnings, apply for leaves, swap shifts, and request support. Managers gain additional team oversight widgets within the same portal.

### 1. Account Access & Biometric Enrollment (`/employee/login`, `/employee/register-device`)
* **Secure Login:** Sign in using email/password or biometric passkeys.
* **One-Time Identity Enrollment:**
  * **Face ID Setup:** Guide webcam/mobile camera scan to capture secure biometric facial descriptors.
  * **Hardware Security Passkey:** Register fingerprint/Face ID/security keys via browser WebAuthn.
  * **Device Binding:** Securely pair personal or kiosk devices to prevent unauthorized clock-ins.

### 2. Employee Dashboard & Live Work Session (`/employee/dashboard`)
* **Real-time Status Header:** Visual indicator showing current state: `Not Started`, `Checked In (Active)`, `On Break`, `Checked Out`.
* **Live Shift Timer:** Tracks elapsed working time down to the second against company business timezone.
* **Quick Action Buttons:** Fast access to check-in, breaks, checkout, and attendance camera.

### 3. Multi-Method Attendance Clock-In (`/employee/attendance`, `/employee/qr-scan`, `/qr/:token`)
* **Method 1: Biometric Face Recognition:**
  1. Open `/employee/attendance`.
  2. Align face within the camera frame.
  3. System validates liveness and matches face confidence score.
  4. Geofence location is verified simultaneously.
  5. Check-in approved with instant visual feedback.
* **Method 2: Dynamic QR Scanner:**
  1. Open scanner on mobile portal or scan dynamic wall kiosk QR code via native camera (`/qr/:token`).
  2. Instant verification confirms presence on site.
* **Method 3: Passkey / Geofence Check-In:**
  1. Tap device fingerprint/face sensor or confirm verified location.

### 4. Work Shift & Break Management
* **Taking Breaks:** Tap **"Take a Break"** to choose break category:
  * ☕ *General Break*
  * 🍱 *Lunch Break*
  * 🍵 *Tea Break*
  * 📝 *Optional Note:* Add task update or destination note.
* **Break Timer & Budget Tracker:** Real-time countdown tracking remaining break time out of daily allotted break budget (e.g., 60 minutes).
* **Return From Break:** Single-tap return button switches state back to `Active Working Time`.

### 5. Attendance Correction Requests
* **Missed Punch / Time Correction:** If check-in was missed or GPS failed:
  1. Click **"Request Correction"**.
  2. Select date, requested punch time, and reason (e.g., client site visit, network failure).
  3. Submit for Manager/HR review. Track approval status live.

### 6. Self-Service Leave Portal
* **Leave Balances Card:** View available quotas for Casual, Sick, Annual, and Special leaves.
* **Applying for Leave:**
  1. Select leave type and start/end dates.
  2. Choose full-day or half-day option.
  3. Attach medical certificate toggle if applicable.
  4. Enter reason and submit.
* **Optional Holidays:** Select company-listed optional/restricted holidays from calendar within assigned quota.
* **Leave Encashment:** Submit encashment requests for eligible unused leave days to receive payout in next payroll cycle.

### 7. Earnings & Digital Payslips
* **Earnings Breakdown Widget:** View estimated base pay, accumulated overtime pay, and projected net salary for the current pay period.
* **Payslip Archive:** Access past payslips, view itemized earnings/deductions, and download official PDF documents.

### 8. Shift Swapping Desk
* **Propose Shift Swap:** Request to trade an upcoming assigned shift with an eligible colleague.
* **Accept / Reject Swaps:** Review incoming swap requests from peers.
* **Manager Approval Tracking:** View status as manager approves the swap.

### 9. Helpdesk & Support Tickets (`/tenant/tickets`)
* **Submit Support Ticket:** Raise tickets for payroll queries, profile changes, hardware issues, or attendance disputes.
* **Live Ticket Tracking:** Receive real-time updates and response logs from HR/Admin.

### 10. Manager Workspace Extensions (For Managers & Supervisors)
Employees holding managerial roles automatically receive additional management tabs inside their employee portal:
* **My Team Live Status:** Real-time roster showing who is present, on break, late, or absent today.
* **Pending Team Approvals:** One-click review desk for team leave applications, attendance corrections, and shift swap requests.

---

## 🚀 Quick Start Workflows

### Super Admin: Initial Platform Setup
1. Log in at `/login` with Super Admin credentials.
2. Navigate to Tenant Management and click **"Add Organization"**.
3. Go to `/super/plan-features/:tenantId` to toggle module flags and set seat limits.
4. Issue Tenant Admin credentials to the client lead.

### Tenant Admin: First-Time Setup
1. Log in at `/login` as Tenant Admin.
2. Complete the **Branch Setup Wizard** at `/tenant/branch-setup` (set GPS coordinates & radius).
3. Set company attendance rules at `/tenant/attendance-preferences`.
4. Create roles & permissions at `/tenant/roles`.
5. Onboard employees in `/tenant/directory`.
6. Configure leave policies at `/tenant/leave` and approval steps at `/tenant/approval-routing`.

### Employee: Daily Routine
1. Log in at `/employee/login` on smartphone or desktop.
2. Complete one-time biometric face enrollment at `/employee/register-device`.
3. Clock in every morning via `/employee/attendance` or kiosk QR scanner.
4. Manage lunch/tea breaks using the **"Take a Break"** button.
5. Clock out at shift end. View live hours worked and leave balances anytime on `/employee/dashboard`.

---

*Smart Teams / AEMS — Enterprise Workforce Verification, Leave & Payroll Solution.*
