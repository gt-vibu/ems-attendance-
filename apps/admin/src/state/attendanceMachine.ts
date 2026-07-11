/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SessionStatus, BreakStatus, PresenceStatus } from '../types';

export interface LogEvent {
  timestamp: string;
  name: string;
  message: string;
}

export type CorrectionState = 'NONE' | 'SUBMITTED' | 'MANAGER_APPROVED' | 'MANAGER_REJECTED' | 'HR_APPROVED' | 'APPLIED';

export class AttendanceStateEngine {
  public sessionState: SessionStatus = SessionStatus.NOT_STARTED;
  public breakState: BreakStatus = BreakStatus.IDLE;
  public presenceState: PresenceStatus = PresenceStatus.INSIDE_OFFICE;
  public correctionState: CorrectionState = 'NONE';
  
  public lowConfidenceToggle: boolean = false;
  public logs: LogEvent[] = [];
  public hasPresenceGap: boolean = false;
  public checkInTime: string | null = null;
  public checkOutTime: string | null = null;
  public confidenceScore: number | null = null;

  private onChangeListeners: (() => void)[] = [];

  constructor() {
    this.addLog('system.init', 'Zero-Trust Attendance Core online');
  }

  public subscribe(listener: () => void) {
    this.onChangeListeners.push(listener);
    return () => {
      this.onChangeListeners = this.onChangeListeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.onChangeListeners.forEach(l => l());
  }

  private addLog(name: string, message: string) {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.logs = [{ timestamp, name, message }, ...this.logs];
  }

  public checkIn() {
    if (this.sessionState !== SessionStatus.NOT_STARTED && this.sessionState !== SessionStatus.CLOSED) return;
    
    this.sessionState = SessionStatus.PENDING_VERIFICATION;
    this.addLog('attendance.check_in_submitted', 'Check-in submitted. Initiating biometrics & liveness pipeline.');
    this.notify();

    // Auto-resolve pipeline after 1.2s
    setTimeout(() => {
      if (this.sessionState !== SessionStatus.PENDING_VERIFICATION) return;

      if (this.lowConfidenceToggle) {
        this.sessionState = SessionStatus.NEEDS_REVIEW;
        this.confidenceScore = 0.62;
        this.addLog('attendance.anomaly_detected', 'Biometric liveness similarity score below threshold (62%). Session flagged.');
      } else {
        this.sessionState = SessionStatus.ACTIVE;
        this.confidenceScore = 0.98;
        this.addLog('attendance.pipeline_passed', 'Multisignals match. Session verified. Core active.');
      }
      this.checkInTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.notify();
    }, 1200);
  }

  public startBreak() {
    if (this.sessionState !== SessionStatus.ACTIVE) return;
    this.sessionState = SessionStatus.ON_BREAK;
    this.breakState = BreakStatus.ACTIVE;
    this.addLog('break.started', 'Coffee break sector started. Geofence presence checks suspended.');
    this.notify();
  }

  public endBreak() {
    if (this.sessionState !== SessionStatus.ON_BREAK) return;
    this.sessionState = SessionStatus.ACTIVE;
    this.breakState = BreakStatus.ENDED;
    this.addLog('break.ended', 'Coffee break ended. Reconciling break logs against presence timeline...');
    this.notify();
  }

  public toggleGeofence(outside: boolean) {
    if (outside) {
      this.presenceState = PresenceStatus.OUTSIDE_OFFICE;
      this.hasPresenceGap = true;
      this.addLog('presence.gap_opened', 'Geofence boundary breach detected. Out of bounds (presence.gap_opened).');
    } else {
      this.presenceState = PresenceStatus.INSIDE_OFFICE;
      this.addLog('presence.gap_closed', 'Geofence boundary re-entry verified (presence.gap_closed).');
    }
    this.notify();
  }

  public checkOut() {
    if (this.sessionState !== SessionStatus.ACTIVE && this.sessionState !== SessionStatus.ON_BREAK) return;

    this.checkOutTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (this.hasPresenceGap && !this.lowConfidenceToggle) {
      this.sessionState = SessionStatus.NEEDS_REVIEW;
      this.addLog('attendance.anomaly_detected', 'Unreconciled presence gap detected during check-out. Flagging for Manager review.');
    } else if (this.lowConfidenceToggle) {
      this.sessionState = SessionStatus.NEEDS_REVIEW;
      this.addLog('attendance.anomaly_detected', 'Low biometric confidence flag persistent. Flagging for Manager review.');
    } else {
      this.sessionState = SessionStatus.CLOSED;
      this.addLog('attendance.checked_out', 'Workday checkout approved. Hour records locked successfully.');
    }
    this.notify();
  }

  public startCorrection() {
    if (this.sessionState !== SessionStatus.NEEDS_REVIEW) return;
    this.correctionState = 'SUBMITTED';
    this.addLog('attendance.corrected', 'Correction request filed. Awaiting Line Manager approval.');
    this.notify();
  }

  public approveManager(approve: boolean) {
    if (this.correctionState !== 'SUBMITTED') return;
    if (approve) {
      this.correctionState = 'MANAGER_APPROVED';
      this.addLog('correction.manager_approved', 'Line Manager approved correction. Forwarding to HR compliance audit.');
    } else {
      this.correctionState = 'MANAGER_REJECTED';
      this.addLog('correction.manager_rejected', 'Line Manager rejected correction request.');
    }
    this.notify();
  }

  public approveHR() {
    if (this.correctionState !== 'MANAGER_APPROVED') return;
    this.correctionState = 'HR_APPROVED';
    this.addLog('correction.hr_approved', 'HR Compliance verified matching coordinates logs. Queueing change for ledger injection.');
    this.notify();

    // Auto apply after 1s
    setTimeout(() => {
      this.correctionState = 'APPLIED';
      this.sessionState = SessionStatus.CLOSED;
      this.addLog('correction.applied', 'Correction injected. Block verified and session closed.');
      this.notify();
    }, 1000);
  }

  public reset() {
    this.sessionState = SessionStatus.NOT_STARTED;
    this.breakState = BreakStatus.IDLE;
    this.presenceState = PresenceStatus.INSIDE_OFFICE;
    this.correctionState = 'NONE';
    this.hasPresenceGap = false;
    this.checkInTime = null;
    this.checkOutTime = null;
    this.confidenceScore = null;
    this.logs = [];
    this.addLog('system.reset', 'Zero-trust simulator state flushed.');
    this.notify();
  }
}

export const attendanceEngine = new AttendanceStateEngine();
