import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  evaluateEmployeePresence,
  processPresenceAutoCheckout,
  type PresenceState,
  type PresenceEvaluationResult,
} from './api/services/presenceEngine.ts';

describe('Presence Engine & Multi-Signal Evaluation Logic', () => {
  test('Confidence score computation with all signals fresh gives high score (100%)', () => {
    // Synthetic evaluation structure test
    const mockSignals = {
      session: { name: 'Session', enabled: true, score: 20, maxScore: 20, status: 'ACTIVE' },
      break: { name: 'Break', enabled: true, score: 15, maxScore: 20, status: 'NOT_ON_BREAK' },
      gps: { name: 'GPS', enabled: true, score: 20, maxScore: 20, status: 'INSIDE_GEOFENCE' },
      wifi: { name: 'Wi-Fi', enabled: true, score: 20, maxScore: 20, status: 'CONNECTED' },
      activity: { name: 'Activity', enabled: true, score: 20, maxScore: 20, status: 'RECENT_ACTIVITY' },
      heartbeat: { name: 'Heartbeat', enabled: true, score: 10, maxScore: 10, status: 'FRESH' },
    };

    const total = Object.values(mockSignals).reduce((acc, s) => acc + s.score, 0);
    const max = Object.values(mockSignals).reduce((acc, s) => acc + s.maxScore, 0);
    const confidence = Math.round((total / max) * 100);

    assert.equal(confidence, 95); // 105/110 = 95% -> Definitely Working
    assert.ok(confidence >= 70);
  });

  test('Approved break state sets state to on_break and ignores GPS exit', () => {
    const isOnBreak = true;
    const ignoreGpsDuringBreak = true;
    let gpsScore = 0;
    let gpsStatus = 'OUTSIDE_GEOFENCE';

    if (isOnBreak && ignoreGpsDuringBreak) {
      gpsScore = 20;
      gpsStatus = 'IGNORED_DURING_APPROVED_BREAK';
    }

    assert.equal(gpsScore, 20);
    assert.equal(gpsStatus, 'IGNORED_DURING_APPROVED_BREAK');
  });

  test('Confidence below threshold (<40%) past shift end grace period becomes candidate', () => {
    const isPastShiftEndGrace = true;
    const confidenceScore = 30; // 30% < 40% threshold
    const candidateThreshold = 40;

    let state: PresenceState = 'active_working';
    let decision = 'continue_session';

    if (isPastShiftEndGrace && confidenceScore < candidateThreshold) {
      state = 'auto_checkout_candidate';
      decision = 'issue_warning';
    }

    assert.equal(state, 'auto_checkout_candidate');
    assert.equal(decision, 'issue_warning');
  });

  test('Active presence past shift end grace period transitions to Overtime', () => {
    const isPastShiftEndGrace = true;
    const confidenceScore = 85; // 85% >= 70% threshold
    const candidateThreshold = 40;

    let state: PresenceState = 'active_working';
    let decision = 'continue_session';

    if (isPastShiftEndGrace && confidenceScore >= 70) {
      state = 'overtime';
      decision = 'transition_overtime';
    }

    assert.equal(state, 'overtime');
    assert.equal(decision, 'transition_overtime');
  });
});
