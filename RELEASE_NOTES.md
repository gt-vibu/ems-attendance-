# Smart Teams EMS — Release Notes & Feature User Guide

Welcome to the **Smart Teams EMS (Enterprise Management Suite)** Release Notes and User Guide. This document details all available features, architectural enhancements, mobile optimizations, and step-by-step instructions on how to use every module.

---

## 📋 Table of Contents
1. [Overview](#1-overview)
2. [Key Features & Capabilities](#2-key-features--capabilities)
   - [🏢 Unified Administration Workspace](#-unified-administration-workspace)
   - [⏱️ Real-Time Presence Detection & Policy Engine](#️-real-time-presence-detection--policy-engine)
   - [📊 Single-View Reports & Analytics Suite](#-single-view-reports--analytics-suite)
   - [📱 Mobile-First Touch & Compact Card System](#-mobile-first-touch--compact-card-system)
   - [👤 Employee Self-Service Portal](#-employee-self-service-portal)
3. [User Guide — Step-by-Step Instructions](#3-user-guide--step-by-step-instructions)
   - [How to Access the Admin Workspace](#how-to-access-the-admin-workspace)
   - [How to Manage Attendance Policies & Presence Detection](#how-to-manage-attendance-policies--presence-detection)
   - [How to Generate & Export Custom Reports](#how-to-generate--export-custom-reports)
   - [How to Use the Mobile Touch Interface](#how-to-use-the-mobile-touch-interface)
   - [How to Submit Tickets & Attendance Regularization Requests](#how-to-submit-tickets--attendance-regularization-requests)
4. [System Requirements & Credentials](#4-system-requirements--credentials)

---

## 1. Overview

Smart Teams EMS is an enterprise-grade Human Capital & Attendance Management System designed to handle multi-tenant organizations, shift scheduling, geo-fenced workspace boundaries, automated payroll structures, and real-time presence verification.

---

## 2. Key Features & Capabilities

### 🏢 Unified Administration Workspace
The administrator console is designed as a single continuous workspace shell with a persistent left navigation panel.
- **Fixed Navigation Bar**: Left sidebar remains locked across all `/tenant/*` administration routes.
- **17 Administration Modules**:
  1. **Admin Overview**: Executive KPI summary cards, live attendance status breakdown, and shift metrics.
  2. **Attendance Preferences**: Presence score thresholds, heartbeat intervals, and auto-checkout rules.
  3. **Workspace Boundaries**: Geo-fencing coordinates, radius bounds, and IP subnet whitelisting.
  4. **Branches**: Multi-location office management with localized timezones and shift schedules.
  5. **Roles & Permissions**: Fine-grained RBAC permission matrix for HR, Managers, Finance, and Admins.
  6. **Teams & Structure**: Organizational department trees, manager assignments, and team rosters.
  7. **Employee Directory**: Centralized workforce directory with status filtering and profile views.
  8. **Delegation**: Temporary managerial approval delegation during leaves or travel.
  9. **Business Calendar**: Public holiday schedules, optional holiday caps, and weekend definitions.
  10. **Approval Routing**: Multi-tier approval workflows for leaves, expenses, and overtime.
  11. **Reports & Analytics**: Comprehensive report builder with preview scaling and export tools.
  12. **Notification Center**: Automated email, in-app broadcast, and alert policies.
  13. **Audit Ledger**: Immutable audit trail tracking every action, login, and configuration change.
  14. **Termination Requests**: Offboarding workflows, exit clearances, and asset returns.
  15. **Shift Swap Requests**: Peer-to-peer shift exchange review and manager approvals.
  16. **Tickets**: Dispute resolution queue with automated multi-tier manager escalation.
  17. **Org Chart**: Interactive visual reporting hierarchy map.

### ⏱️ Real-Time Presence Detection & Policy Engine
- **Multi-Signal Score Evaluation**: Evaluates active browser tab focus, heartbeats, and user activity signals.
- **Auto-Checkout Protection**: Gentle interactive warning modal prompts inactive users before triggering automatic shift check-out.
- **Configurable Rules**: Admins can customize heartbeat intervals (e.g. 60s) and idle timeout windows.

### 📊 Single-View Reports & Analytics Suite
- **Single Viewport Layout**: Left Admin Navigation, Report Document Preview, and Edit Options Sidebar fit together in one view.
- **Integrated View Scale Control**: Switch between `100% Full`, `85% Fit` (default), and `75% Compact` to inspect reports without horizontal scrolling.
- **Export Options**: Download instant reports in PDF, CSV, or Excel formats.

### 📱 Mobile-First Touch & Compact Card System
- **1-Line Summary Cards**: On mobile screens (<768px), wide data tables automatically transform into compact, 1-line cards displaying key attributes and status badges.
- **Bottom Sheet Detail Drawer**: Tapping any 1-line mobile card opens a smooth bottom-sheet modal displaying full record details.
- **Vertical Balance Card Grid**: Leave balance cards stack in clean 1-column responsive grids on mobile view to eliminate horizontal scrolling.
- **Floating Action (+) Buttons**: Prominent floating `+` buttons on mobile screens allow one-tap creation of tickets or attendance regularization requests.
- **Overscroll Void Prevention**: Dynamic viewport height (`min-h-dvh`) and `overscroll-behavior-y: none` eliminate empty scrolling space below cards.

### 👤 Employee Self-Service Portal
- **One-Tap Check-In / Check-Out**: Live attendance check-in button with real-time timer tracking formatted for single-line mobile display.
- **Leave Tracker**: Real-time balance meters, leave application form, encashment requests, and optional holiday selection.
- **Salary Structure & Past Payslips**: Detailed earnings/deductions breakup and secure PDF downloads for past months' payslips.

---

## 3. User Guide — Step-by-Step Instructions

### How to Access the Admin Workspace
1. Log in with Super Admin or Tenant Admin credentials.
2. Click **Admin Console** in the top navigation bar or navigate to `/tenant/admin`.
3. Use the left navigation panel to switch between modules (e.g. *Workspace Boundaries*, *Roles & Permissions*, *Audit Ledger*).

### How to Manage Attendance Policies & Presence Detection
1. Open the Admin Console and select **Attendance Preferences** (`/tenant/attendance-preferences`).
2. Adjust presence heartbeat frequency and auto-checkout warning thresholds.
3. Click **Save Preferences**. The presence detection engine will immediately enforce the updated rules.

### How to Generate & Export Custom Reports
1. Open the Admin Console and select **Reports & Analytics** (`/tenant/reports`).
2. Select a report template (e.g., *Daily Attendance Summary*, *Monthly Payroll Payout*).
3. Use the View Scale dropdown (`85% Fit`) to adjust viewport sizing.
4. Click **Export Report** and select PDF or CSV format.

### How to Use the Mobile Touch Interface
1. Open Smart Teams EMS on any mobile smartphone or tablet browser.
2. Use the bottom navigation bar (`Overview`, `Attendance`, `Earnings`, `Leave`, `More`) to switch tabs.
3. Tap any 1-line summary card in list views to open the **Record Details Bottom Sheet**.

### How to Submit Tickets & Attendance Regularization Requests
1. Navigate to the **Tickets** or **Requests** tab on the Employee Portal.
2. Tap the floating **+** button in the bottom right corner.
3. Fill out the request form (Category, Date in Question, Subject, and Description).
4. Tap **Submit Request**. Your manager will be notified automatically.

---

## 4. System Requirements & Credentials

- **Supported Browsers**: Chrome (latest), Safari (latest), Edge (latest), Firefox (latest).
- **Default Seed Super Admin Login**:
  - **Email**: `vibudarshan1717@gmail.com`
  - **Password**: `Bakyalakshmi@18`
