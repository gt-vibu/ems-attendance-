/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum SessionStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  ON_BREAK = 'ON_BREAK',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
  CLOSED = 'CLOSED',
  ABSENT = 'ABSENT',
  REJECTED = 'REJECTED'
}

export enum BreakStatus {
  IDLE = 'IDLE',
  REQUESTED = 'REQUESTED',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  RECONCILED = 'RECONCILED'
}

export enum PresenceStatus {
  INSIDE_OFFICE = 'INSIDE_OFFICE',
  OUTSIDE_OFFICE = 'OUTSIDE_OFFICE',
  PRESENCE_UNKNOWN = 'PRESENCE_UNKNOWN',
  NEAR_BOUNDARY = 'NEAR_BOUNDARY'
}

export enum AnomalySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface Branch {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  wifiSsid: string;
}

export interface UserSession {
  id: string;
  userId: string;
  userName: string;
  userRole: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  status: SessionStatus;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  confidenceScore: number;
  policyVersion: string;
  breaksCount: number;
  workingHours: number; // in hours
}

export interface BreakRecord {
  id: string;
  type: string;
  status: BreakStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationMin: number;
  requiresApproval: boolean;
}

export interface PresenceGap {
  id: string;
  type: 'GPS_EXIT' | 'GPS_DISABLED' | 'WIFI_DISCONNECT';
  openedAt: string;
  closedAt: string | null;
  durationMin: number;
  resolved: boolean;
}

export interface AttendanceAnomaly {
  id: string;
  userName: string;
  type: 'RECONCILIATION_MISMATCH' | 'GPS_GAP' | 'DEVICE_UNTRUSTED' | 'IMPOSSIBLE_TRAVEL';
  severity: AnomalySeverity;
  description: string;
  timeDetected: string;
  resolved: boolean;
}

export interface CorrectionRequest {
  id: string;
  userName: string;
  requestedDate: string;
  status: 'DRAFT' | 'SUBMITTED' | 'MANAGER_APPROVED' | 'APPLIED' | 'WITHDRAWN';
  preSnapshot: {
    checkIn: string | null;
    checkOut: string | null;
    breakDuration: number;
  };
  postChanges: {
    checkIn: string;
    checkOut: string;
    breakDuration: number;
  };
  notes: string;
  approvalsChain: {
    role: string;
    actor: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    time: string | null;
  }[];
  slaHoursRemaining: number;
}

export interface PolicyRule {
  id: string;
  category: 'BIOMETRIC' | 'GEOFENCE' | 'BREAKS' | 'GRACE_PERIOD';
  name: string;
  description: string;
  condition: string;
  action: string;
  active: boolean;
}
