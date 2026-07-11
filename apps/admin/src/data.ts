/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Branch, PolicyRule, AttendanceAnomaly, CorrectionRequest, UserSession, SessionStatus, AnomalySeverity } from './types';

export const BRANCHES: Branch[] = [
  { id: 'b1', name: 'HQ Corporate Tower', latitude: 37.7749, longitude: -122.4194, radiusMeters: 50, wifiSsid: 'HQ_Secure_Corp' },
  { id: 'b2', name: 'Downtown Tech Hub', latitude: 37.7891, longitude: -122.4014, radiusMeters: 35, wifiSsid: 'TechHub_Guest_Enterprise' },
  { id: 'b3', name: 'West Logistics Warehouse', latitude: 37.7556, longitude: -122.4401, radiusMeters: 80, wifiSsid: 'Warehouse_Logistics_Local' },
  { id: 'b4', name: 'East Research Campus', latitude: 37.7699, longitude: -122.4468, radiusMeters: 60, wifiSsid: 'East_Campus_5G' }
];

export const INITIAL_RULES: PolicyRule[] = [
  {
    id: 'r1',
    category: 'BIOMETRIC',
    name: 'Multi-Angle Liveness Check',
    description: 'Requires a random active challenge (blinking, head turning) and choice of best out of 20 burst frames.',
    condition: 'livenessConfidence < 0.90',
    action: 'flagSession(NEEDS_REVIEW, AnomalyType.BIOMETRIC_MISMATH, HIGH)',
    active: true
  },
  {
    id: 'r2',
    category: 'GEOFENCE',
    name: 'Geofence Guard & Boundary Coherence',
    description: 'Verifies employee coordinates are within configured radii of registered physical branches.',
    condition: 'distanceToNearestBranchMeters > activeBranch.radiusMeters',
    action: 'preventCheckIn() or flagSession(NEEDS_REVIEW, AnomalyType.GPS_GAP, CRITICAL)',
    active: true
  },
  {
    id: 'r3',
    category: 'BREAKS',
    name: 'Observed Telemetry Reconciliation',
    description: 'Compares user-declared break durations with GPS geofence exit and reentry telemetry events.',
    condition: 'actualGeofenceExitMinutes - declaredBreakMinutes > 15',
    action: 'flagSession(NEEDS_REVIEW, AnomalyType.RECONCILIATION_MISMATCH, MEDIUM)',
    active: true
  },
  {
    id: 'r4',
    category: 'GRACE_PERIOD',
    name: 'Duty Grace Limits',
    description: 'Configures a maximum allowance for late arrival at the beginning of active work shifts.',
    condition: 'checkInMinutesPastShiftStart > 15',
    action: 'markStatus(LATE) and notifyManager(LATE_ARRIVAL_ESCALATION)',
    active: true
  }
];

export const MOCK_ANOMALIES: AttendanceAnomaly[] = [
  {
    id: 'a1',
    userName: 'David Miller',
    type: 'RECONCILIATION_MISMATCH',
    severity: AnomalySeverity.HIGH,
    description: 'David declared a 15-minute lunch break, but Geofence telemetry indicates he remained outside the perimeter for 55 minutes.',
    timeDetected: 'Today, 12:45 PM',
    resolved: false
  },
  {
    id: 'a2',
    userName: 'Sarah Jenkins',
    type: 'GPS_GAP',
    severity: AnomalySeverity.CRITICAL,
    description: 'Sarah checked in successfully, but disabled GPS tracking 12 minutes later. Presence telemetry reports "Presence Unknown" for 120+ minutes.',
    timeDetected: 'Today, 10:15 AM',
    resolved: false
  },
  {
    id: 'a3',
    userName: 'Alex Wong',
    type: 'DEVICE_UNTRUSTED',
    severity: AnomalySeverity.MEDIUM,
    description: 'Active session check-in submitted from an unregistered, rooted Android device with an unverified installation footprint.',
    timeDetected: 'Today, 09:05 AM',
    resolved: true
  }
];

export const MOCK_CORRECTIONS: CorrectionRequest[] = [
  {
    id: 'c1',
    userName: 'Marcus Aurelius',
    requestedDate: '2026-07-06',
    status: 'SUBMITTED',
    preSnapshot: {
      checkIn: '09:24 AM',
      checkOut: '05:00 PM',
      breakDuration: 30
    },
    postChanges: {
      checkIn: '08:58 AM',
      checkOut: '05:00 PM',
      breakDuration: 30
    },
    notes: 'Arrived at office at 8:58 AM but office internet was down, preventing me from getting through check-in verification until IT restored it at 9:24 AM.',
    approvalsChain: [
      { role: 'Line Manager', actor: 'Supervisor Ken', status: 'PENDING', time: null },
      { role: 'HR Business Partner', actor: 'HR Team', status: 'PENDING', time: null }
    ],
    slaHoursRemaining: 18
  },
  {
    id: 'c2',
    userName: 'Emma Watson',
    requestedDate: '2026-07-05',
    status: 'MANAGER_APPROVED',
    preSnapshot: {
      checkIn: '09:00 AM',
      checkOut: '03:15 PM',
      breakDuration: 45
    },
    postChanges: {
      checkIn: '09:00 AM',
      checkOut: '05:00 PM',
      breakDuration: 45
    },
    notes: 'Forgot to check out before leaving to attend client site meeting. Left the office building at 5:00 PM exactly, but checked out on the train at 6:30 PM.',
    approvalsChain: [
      { role: 'Line Manager', actor: 'Supervisor Ken', status: 'APPROVED', time: 'Yesterday, 4:12 PM' },
      { role: 'HR Business Partner', actor: 'HR Team', status: 'PENDING', time: null }
    ],
    slaHoursRemaining: 8
  }
];

export const MOCK_TEAM_SESSIONS: UserSession[] = [
  {
    id: 's1',
    userId: 'u1',
    userName: 'John Doe',
    userRole: 'EMPLOYEE',
    status: SessionStatus.ACTIVE,
    checkedInAt: '09:02 AM',
    checkedOutAt: null,
    confidenceScore: 0.98,
    policyVersion: 'v2.4.1',
    breaksCount: 1,
    workingHours: 4.5
  },
  {
    id: 's2',
    userId: 'u2',
    userName: 'Marcus Aurelius',
    userRole: 'EMPLOYEE',
    status: SessionStatus.NEEDS_REVIEW,
    checkedInAt: '09:24 AM',
    checkedOutAt: null,
    confidenceScore: 0.62,
    policyVersion: 'v2.4.1',
    breaksCount: 0,
    workingHours: 4.1
  },
  {
    id: 's3',
    userId: 'u3',
    userName: 'Emma Watson',
    userRole: 'EMPLOYEE',
    status: SessionStatus.ON_BREAK,
    checkedInAt: '08:45 AM',
    checkedOutAt: null,
    confidenceScore: 0.95,
    policyVersion: 'v2.4.1',
    breaksCount: 2,
    workingHours: 4.8
  },
  {
    id: 's4',
    userId: 'u4',
    userName: 'David Miller',
    userRole: 'EMPLOYEE',
    status: SessionStatus.CLOSED,
    checkedInAt: '09:00 AM',
    checkedOutAt: '05:00 PM',
    confidenceScore: 0.74,
    policyVersion: 'v2.4.0',
    breaksCount: 1,
    workingHours: 8.0
  }
];
