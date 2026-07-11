// OpenAPI 3.0 spec for the Smart Teams API, served at /api/docs (Swagger UI)
// and /api/openapi.json (raw spec) — see server.ts. Every path here mirrors
// an actual route in server.ts; this file is documentation, not a second
// source of truth for routing (nothing here changes request handling).
//
// External integrators should call the versioned form, /api/v1/..., which
// is a transparent rewrite to the same handlers as /api/... (see the
// rewrite middleware in server.ts) — both work identically today.

const bearerAuth = { bearerAuth: [] as string[] };

const ErrorResponse = {
  type: 'object',
  properties: { error: { type: 'string' } },
};

const User = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    uid: { type: 'string' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
    role: { type: 'string', description: "'super_admin' | 'tenant_admin' | 'employee' | 'manager' | 'HR' | 'GM' | any custom role a tenant admin creates" },
    tenantId: { type: 'integer', nullable: true },
    isKycCompleted: { type: 'boolean' },
  },
};

const AuthSuccess = {
  type: 'object',
  properties: {
    token: { type: 'string', description: 'JWT bearer token, 24h expiry' },
    user: User,
  },
};

const Tenant = {
  type: 'object',
  description: 'Full tenant policy row — every field is tenant-admin-configurable via POST /tenant/config/update.',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    status: { type: 'string', enum: ['active', 'suspended'] },
    wifiSsid: { type: 'string', nullable: true },
    officeIp: { type: 'string', nullable: true },
    wifiCheckEnabled: { type: 'boolean' },
    locationLat: { type: 'number', nullable: true },
    locationLng: { type: 'number', nullable: true },
    locationRadiusMeters: { type: 'integer' },
    plan: { type: 'string' },
    shiftStart: { type: 'string', example: '09:00' },
    shiftEnd: { type: 'string', example: '18:00' },
    gracePeriodMins: { type: 'integer' },
    halfDayMins: { type: 'integer' },
    weekendConfig: { type: 'array', items: { type: 'string' } },
    dailyBreakBudgetMins: { type: 'integer' },
    minAttendancePercent: { type: 'integer' },
    wfhEnabled: { type: 'boolean' },
    wfhAllowedRoles: { type: 'array', items: { type: 'string' }, nullable: true },
    wfhMaxDaysPerMonth: { type: 'integer', nullable: true },
    wfhAllowedWeekdays: { type: 'array', items: { type: 'string' } },
    wfhRadiusMeters: { type: 'integer' },
    wfhApprovalRequired: { type: 'boolean' },
    wfhRequireReason: { type: 'boolean' },
    wfhLateLoginGraceMins: { type: 'integer', nullable: true },
  },
};

const AttendanceLog = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    userId: { type: 'integer' },
    tenantId: { type: 'integer' },
    status: { type: 'string', enum: ['approved', 'rejected', 'pending'] },
    type: { type: 'string', enum: ['check_in', 'check_out', 'absent'] },
    attendanceMode: { type: 'string', enum: ['office', 'wfh'] },
    faceMatchScore: { type: 'number', nullable: true },
    livenessScore: { type: 'number', nullable: true },
    locationLat: { type: 'number', nullable: true },
    locationLng: { type: 'number', nullable: true },
    homeLat: { type: 'number', nullable: true },
    homeLng: { type: 'number', nullable: true },
    distanceFromHomeMeters: { type: 'number', nullable: true },
    wfhReason: { type: 'string', nullable: true },
    reason: { type: 'string', nullable: true },
    explanation: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

function jsonBody(schema: any) {
  return { required: true, content: { 'application/json': { schema } } };
}
function okResponse(schema: any, description = 'Success') {
  return { description, content: { 'application/json': { schema } } };
}
const errorResponses = {
  '400': okResponse(ErrorResponse, 'Bad request'),
  '401': okResponse(ErrorResponse, 'Missing/invalid bearer token'),
  '403': okResponse(ErrorResponse, 'Authenticated but not authorized (role/privilege check failed)'),
  '404': okResponse(ErrorResponse, 'Not found'),
  '500': okResponse(ErrorResponse, 'Unexpected server error'),
};

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Smart Teams API',
    version: '1.0.0',
    description:
      'Multi-tenant employee attendance, biometric KYC, and Work From Home API. ' +
      'All endpoints below are shown at their unversioned path (/...); external ' +
      'integrations should prefix every path with /api/v1 instead of /api — both ' +
      'resolve to the exact same handler (see server.ts). Authenticate with ' +
      '`Authorization: Bearer <token>` obtained from POST /auth/login.',
  },
  servers: [
    { url: '/api/v1', description: 'Versioned (recommended for external integrations)' },
    { url: '/api', description: 'Unversioned (used internally by the bundled frontend)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: { User, Tenant, AttendanceLog, ErrorResponse },
  },
  tags: [
    { name: 'Health', description: 'Liveness check' },
    { name: 'Auth', description: 'Login, password reset, Google Sign-In' },
    { name: 'Tenancy Onboarding', description: 'Public sign-up request + super-admin approval' },
    { name: 'Super Admin', description: 'Platform-wide oversight (role: super_admin only)' },
    { name: 'Tenant Admin', description: 'Per-tenant configuration and staff management' },
    { name: 'KYC', description: 'Biometric enrollment (server-side face detection/liveness)' },
    { name: 'Attendance', description: 'Office check-in/out, corrections, heartbeat' },
    { name: 'Work From Home', description: 'WFH attendance mode, home-location registration and change requests' },
    { name: 'Breaks', description: 'Break session start/end and daily budget' },
    { name: 'Alerts & Notifications', description: 'Timing/fraud alerts and tenant notifications' },
    { name: 'Audit Ledger', description: 'Immutable, hash-chained activity log' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: { '200': okResponse({ type: 'object', properties: { status: { type: 'string', example: 'ok' } } }) },
      },
    },

    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with email + password',
        requestBody: jsonBody({
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string' }, password: { type: 'string' }, deviceId: { type: 'string', description: 'Required for clock-in-capable roles; pins the account to one device.' } },
        }),
        responses: {
          '200': okResponse({ oneOf: [AuthSuccess, { type: 'object', properties: { requirePasswordChange: { type: 'boolean' }, tempToken: { type: 'string' } } }] }),
          ...errorResponses,
        },
      },
    },
    '/auth/google': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with a Google ID token (existing accounts only, matched by email)',
        requestBody: jsonBody({ type: 'object', required: ['credential'], properties: { credential: { type: 'string', description: 'Google Identity Services ID token' }, deviceId: { type: 'string' } } }),
        responses: { '200': okResponse(AuthSuccess), ...errorResponses },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Set a permanent password (forced flow, using the tempToken from a temp-password login)',
        security: [bearerAuth],
        description: 'Authorization header must carry the short-lived tempToken returned by /auth/login, not a normal session token.',
        requestBody: jsonBody({ type: 'object', required: ['newPassword'], properties: { newPassword: { type: 'string', minLength: 8 } } }),
        responses: { '200': okResponse(AuthSuccess), ...errorResponses },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request a self-service password reset email',
        description: 'Always returns a generic success message, whether or not the email matched an account, to avoid user enumeration.',
        requestBody: jsonBody({ type: 'object', required: ['email'], properties: { email: { type: 'string' } } }),
        responses: { '200': okResponse({ type: 'object', properties: { message: { type: 'string' } } }) },
      },
    },
    '/auth/forgot-password/confirm': {
      post: {
        tags: ['Auth'],
        summary: 'Confirm a self-service password reset',
        requestBody: jsonBody({ type: 'object', required: ['token', 'newPassword'], properties: { token: { type: 'string' }, newPassword: { type: 'string', minLength: 8 } } }),
        responses: { '200': okResponse({ type: 'object', properties: { message: { type: 'string' } } }), ...errorResponses },
      },
    },

    '/tenancy/request': {
      post: {
        tags: ['Tenancy Onboarding'],
        summary: 'Submit a new company sign-up request (public)',
        requestBody: jsonBody({ type: 'object', required: ['companyName', 'email', 'numEmployees', 'plan'], properties: { companyName: { type: 'string' }, email: { type: 'string' }, numEmployees: { type: 'integer' }, plan: { type: 'string', enum: ['Basic', 'Professional', 'Enterprise'] } } }),
        responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' }, request: { type: 'object' } } }), ...errorResponses },
      },
    },

    '/super/requests': { get: { tags: ['Super Admin'], summary: 'List all tenancy requests', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { requests: { type: 'array', items: { type: 'object' } } } }), ...errorResponses } } },
    '/super/notifications': { get: { tags: ['Super Admin'], summary: 'Platform-wide notifications', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { notifications: { type: 'array', items: { type: 'object' } } } }), ...errorResponses } } },
    '/super/approve': {
      post: {
        tags: ['Super Admin'],
        summary: 'Approve a tenancy request — provisions the tenant + its first tenant_admin, emails credentials',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', required: ['requestId'], properties: { requestId: { type: 'integer' }, plan: { type: 'string' }, featuresAllowed: { type: 'array', items: { type: 'string' } } } }),
        responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses },
      },
    },
    '/super/tenants': { get: { tags: ['Super Admin'], summary: 'List all tenants with live employee counts', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { tenants: { type: 'array', items: Tenant } } }), ...errorResponses } } },
    '/super/tenants/status': {
      post: {
        tags: ['Super Admin'],
        summary: 'Suspend or reactivate a tenant',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', required: ['tenantId', 'status'], properties: { tenantId: { type: 'integer' }, status: { type: 'string', enum: ['active', 'suspended'] } } }),
        responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses },
      },
    },
    '/super/analytics': { get: { tags: ['Super Admin'], summary: 'Organization-wide analytics snapshot', security: [bearerAuth], responses: { '200': okResponse({ type: 'object' }), ...errorResponses } } },

    '/tenant/analytics': { get: { tags: ['Tenant Admin'], summary: "Today's/this-month's attendance snapshot for the caller's tenant", security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { totalStaff: { type: 'integer' }, presentToday: { type: 'integer' }, absentToday: { type: 'integer' }, lateToday: { type: 'integer' }, rejectedToday: { type: 'integer' }, monthlyCheckIns: { type: 'integer' }, monthlyRejections: { type: 'integer' }, staffByRole: { type: 'object' } } }), ...errorResponses } } },
    '/tenant/users/create': {
      post: {
        tags: ['Tenant Admin'],
        summary: 'Hire a new employee/manager (requires employee.create privilege)',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', required: ['email', 'name', 'role'], properties: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, privileges: { type: 'array', items: { type: 'string' } } } }),
        responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses },
      },
    },
    '/tenant/users': { get: { tags: ['Tenant Admin'], summary: 'List staff in the caller\'s tenant', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { users: { type: 'array', items: User } } }), ...errorResponses } } },
    '/tenant/notifications': { get: { tags: ['Alerts & Notifications'], summary: 'Tenant-wide notification feed', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { notifications: { type: 'array', items: { type: 'object' } } } }), ...errorResponses } } },
    '/tenant/device-requests': { get: { tags: ['Tenant Admin'], summary: 'List pending device-change requests (requires settings.edit)', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { requests: { type: 'array', items: { type: 'object' } } } }), ...errorResponses } } },
    '/tenant/device-requests/action': {
      post: {
        tags: ['Tenant Admin'],
        summary: 'Approve or reject a device-change request',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', required: ['requestId', 'action'], properties: { requestId: { type: 'integer' }, action: { type: 'string', enum: ['approve', 'reject'] } } }),
        responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses },
      },
    },
    '/tenant/config': { get: { tags: ['Tenant Admin'], summary: 'Get the caller\'s tenant policy config', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { tenant: Tenant } }), ...errorResponses } } },
    '/tenant/config/update': {
      post: {
        tags: ['Tenant Admin'],
        summary: 'Update tenant policy (office geofence, Wi-Fi, shift/break rules, WFH policy) — tenant_admin role only',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', description: 'Any subset of Tenant fields (camelCase); omitted fields are left unchanged.' }),
        responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses },
      },
    },

    '/kyc': {
      post: {
        tags: ['KYC'],
        summary: 'Submit guided-pose biometric enrollment (one-time; all detection happens server-side)',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', required: ['actions', 'deviceId'], properties: { actions: { type: 'object', description: "{ [poseName]: string[] } — a burst of JPEG data URLs per guided pose (look_center, turn_left, turn_right, look_up, look_down, smile, open_mouth, blink)." }, deviceId: { type: 'string' } } }),
        responses: {
          '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' }, token: { type: 'string' }, user: User } }),
          '422': okResponse({ type: 'object', properties: { error: { type: 'string' }, failedActions: { type: 'array', items: { type: 'string' } } } }, 'One or more poses could not be confirmed — redo just those poses.'),
          ...errorResponses,
        },
      },
    },

    '/attendance/challenge': { get: { tags: ['Attendance'], summary: 'Get a fresh liveness challenge (3 random actions) for the next face scan', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { challenge: { type: 'array', items: { type: 'string' } } } }) } } },
    '/attendance/today': { get: { tags: ['Attendance'], summary: "Caller's attendance state for today", security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { state: { type: 'string', enum: ['not_started', 'checked_in', 'checked_out'] }, pending: { type: 'boolean' }, log: AttendanceLog } }) } } },
    '/attendance/percentage': { get: { tags: ['Attendance'], summary: 'Monthly attendance percentage vs. the tenant minimum', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { percentage: { type: 'integer' }, threshold: { type: 'integer' }, daysPresent: { type: 'integer' }, workingDaysSoFar: { type: 'integer' } } }) } } },
    '/attendance/mine': { get: { tags: ['Attendance'], summary: 'Read-only attendance history (capped, ?limit=)', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { logs: { type: 'array', items: AttendanceLog } } }) } } },
    '/attendance/verify-face': {
      post: {
        tags: ['Attendance'],
        summary: 'Step 1/3: submit a camera burst for identity + liveness + challenge-response verification',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', required: ['images'], properties: { images: { type: 'array', items: { type: 'string' }, description: 'Short burst of JPEG data URLs' } } }),
        responses: { '200': okResponse({ type: 'object', properties: { passed: { type: 'boolean' }, token: { type: 'string', description: "Short-lived 'attendance_face_pass' token, required by /attendance/verify-location, /verify-network, and the final /attendance submit" }, faceMatchScore: { type: 'number' }, livenessScore: { type: 'number' } } }), '403': okResponse({ type: 'object', properties: { passed: { type: 'boolean' }, error: { type: 'string' } } }), ...errorResponses },
      },
    },
    '/attendance/verify-location': { post: { tags: ['Attendance'], summary: 'Step 2/3: fast-fail office-geofence preview (not authoritative)', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['lat', 'lng', 'token'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, token: { type: 'string' } } }), responses: { '200': okResponse({ type: 'object', properties: { passed: { type: 'boolean' }, distanceMeters: { type: 'number' } } }), ...errorResponses } } },
    '/attendance/verify-network': { post: { tags: ['Attendance'], summary: 'Step 3/3: fast-fail corporate-Wi-Fi preview (only relevant if the tenant enabled it)', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['token'], properties: { simulatedIp: { type: 'string' }, token: { type: 'string' } } }), responses: { '200': okResponse({ type: 'object', properties: { passed: { type: 'boolean' } } }), ...errorResponses } } },
    '/attendance': {
      post: {
        tags: ['Attendance', 'Work From Home'],
        summary: 'Authoritative check-in/out submit — the only endpoint that actually records attendance',
        description:
          'Re-validates everything server-side regardless of the preview steps above. ' +
          "Set mode:'wfh' to submit as Work From Home instead of office (default); WFH validates " +
          'distance against the registered home location instead of the office geofence, and skips the Wi-Fi check entirely.',
        security: [bearerAuth],
        requestBody: jsonBody({
          type: 'object',
          required: ['token', 'deviceId', 'lat', 'lng'],
          properties: {
            token: { type: 'string', description: "attendance_face_pass token from /attendance/verify-face" },
            deviceId: { type: 'string' },
            lat: { type: 'number' },
            lng: { type: 'number' },
            simulatedIp: { type: 'string', description: 'Dev-only network override' },
            clientTimestamp: { type: 'string', format: 'date-time' },
            explanation: { type: 'string', description: 'Required if the check-in is late (any mode)' },
            mode: { type: 'string', enum: ['office', 'wfh'], default: 'office' },
            wfhReason: { type: 'string', description: "Required when mode='wfh' and the tenant's wfhRequireReason policy is on" },
          },
        }),
        responses: {
          '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' }, log: AttendanceLog, pendingApproval: { type: 'boolean' } } }),
          '400': okResponse({ type: 'object', properties: { error: { type: 'string' }, requiresExplanation: { type: 'boolean' }, requiresWfhReason: { type: 'boolean' }, needsHomeRegistration: { type: 'boolean' }, locked: { type: 'boolean' } } }),
          '403': okResponse({ type: 'object', properties: { error: { type: 'string' }, log: AttendanceLog } }, 'Verification failed (biometric/location/network) — log is still recorded as rejected.'),
          ...errorResponses,
        },
      },
    },
    '/attendance/checkout': { post: { tags: ['Attendance'], summary: 'Quick checkout (no re-scan) — blocked while a break is active', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses } } },
    '/attendance/heartbeat': { post: { tags: ['Attendance'], summary: 'Continuous presence ping while checked in (updates last-known GPS, flags geofence/Wi-Fi drift)', security: [bearerAuth], requestBody: jsonBody({ type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, simulatedIp: { type: 'string' }, deviceId: { type: 'string' } } }), responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' }, status: { type: 'string', enum: ['ok', 'warning'] }, message: { type: 'string' } } }) } } },
    '/attendance/corrections': { post: { tags: ['Attendance'], summary: 'Request a correction for a missed/incorrect attendance record', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['requestType', 'requestedDate', 'reason'], properties: { requestType: { type: 'string', enum: ['missed_checkin', 'missed_checkout', 'wrong_location', 'other'] }, requestedDate: { type: 'string' }, requestedTime: { type: 'string' }, reason: { type: 'string' } } }), responses: { '200': okResponse({ type: 'object' }), ...errorResponses } } },
    '/attendance/corrections/mine': { get: { tags: ['Attendance'], summary: "Caller's own correction request history", security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { corrections: { type: 'array', items: { type: 'object' } } } }) } } },
    '/tenant/corrections': { get: { tags: ['Attendance'], summary: 'Approver queue for correction requests (requires attendance.approve)', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { corrections: { type: 'array', items: { type: 'object' } } } }), ...errorResponses } } },
    '/tenant/corrections/action': { post: { tags: ['Attendance'], summary: 'Approve or reject a correction request', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['correctionId', 'action'], properties: { correctionId: { type: 'integer' }, action: { type: 'string', enum: ['approve', 'reject'] } } }), responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses } } },
    '/tenant/attendance/pending': { get: { tags: ['Attendance', 'Work From Home'], summary: 'Approver queue for pending check-ins — both late-arrival AND WFH check-ins land here (requires attendance.approve)', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { logs: { type: 'array', items: AttendanceLog } } }), ...errorResponses } } },
    '/tenant/attendance/action': { post: { tags: ['Attendance', 'Work From Home'], summary: 'Approve or reject a pending check-in (late arrival or WFH)', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['logId', 'action'], properties: { logId: { type: 'integer' }, action: { type: 'string', enum: ['approve', 'reject'] } } }), responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses } } },

    '/attendance/wfh/eligibility': {
      get: {
        tags: ['Work From Home'],
        summary: 'Check whether the caller can start WFH today, before opening the camera',
        security: [bearerAuth],
        responses: { '200': okResponse({ type: 'object', properties: { eligible: { type: 'boolean' }, reason: { type: 'string' }, needsHomeRegistration: { type: 'boolean' }, policy: { type: 'object', properties: { radiusMeters: { type: 'integer' }, requireReason: { type: 'boolean' }, allowedWeekdays: { type: 'array', items: { type: 'string' } }, maxDaysPerMonth: { type: 'integer', nullable: true }, wfhCheckInsThisMonth: { type: 'integer' } } }, homeLocation: { type: 'object', nullable: true, properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, address: { type: 'string', nullable: true } } } } }), ...errorResponses },
      },
    },
    '/attendance/wfh/home-location': { get: { tags: ['Work From Home'], summary: "Get the caller's currently registered home location, if any", security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { homeLocation: { type: 'object', nullable: true } } }) } } },
    '/attendance/wfh/register-home': {
      post: {
        tags: ['Work From Home'],
        summary: 'First-time home-location registration (one-time; later changes require an approved location-change request)',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, accuracy: { type: 'number' } } }),
        responses: { '200': okResponse({ type: 'object', properties: { homeLocation: { type: 'object' } } }), '400': okResponse(ErrorResponse, 'A home location is already registered'), ...errorResponses },
      },
    },
    '/attendance/wfh/location-change-request': {
      post: {
        tags: ['Work From Home'],
        summary: 'Request a change to the registered home location (requires manager/admin approval)',
        security: [bearerAuth],
        requestBody: jsonBody({ type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, accuracy: { type: 'number' }, reason: { type: 'string' } } }),
        responses: { '200': okResponse({ type: 'object', properties: { request: { type: 'object' } } }), ...errorResponses },
      },
    },
    '/attendance/wfh/location-change-requests/mine': { get: { tags: ['Work From Home'], summary: "Caller's own location-change request history", security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { requests: { type: 'array', items: { type: 'object' } } } }) } } },
    '/tenant/wfh/location-change-requests': { get: { tags: ['Work From Home'], summary: 'Approver queue for home-location change requests (requires attendance.approve)', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { requests: { type: 'array', items: { type: 'object' } } } }), ...errorResponses } } },
    '/tenant/wfh/location-change-requests/action': { post: { tags: ['Work From Home'], summary: 'Approve or reject a home-location change request', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['requestId', 'action'], properties: { requestId: { type: 'integer' }, action: { type: 'string', enum: ['approve', 'reject'] } } }), responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses } } },
    '/tenant/wfh/stats': { get: { tags: ['Work From Home'], summary: 'WFH dashboard stats: today/monthly counts, pending approvals, office-vs-WFH trend, role breakdown (requires reports.view)', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { todayWfhCount: { type: 'integer' }, monthlyWfhCount: { type: 'integer' }, pendingWfhApprovals: { type: 'integer' }, pendingLocationChangeRequests: { type: 'integer' }, officeVsWfh30d: { type: 'object', properties: { office: { type: 'integer' }, wfh: { type: 'integer' } } }, roleWiseWfhThisMonth: { type: 'object' } } }), ...errorResponses } } },

    '/breaks/active': { get: { tags: ['Breaks'], summary: 'Currently active break session, if any', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { active: { type: 'object', nullable: true } } }) } } },
    '/breaks/today': { get: { tags: ['Breaks'], summary: "Today's break sessions + remaining budget", security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { sessions: { type: 'array', items: { type: 'object' } }, budgetMins: { type: 'integer' }, usedMins: { type: 'integer' }, remainingMins: { type: 'integer' } } }) } } },
    '/breaks/start': { post: { tags: ['Breaks'], summary: 'Start a break (blocked if one is already active)', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['lat', 'lng'], properties: { breakType: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } }), responses: { '200': okResponse({ type: 'object', properties: { session: { type: 'object' } } }), ...errorResponses } } },
    '/breaks/end': { post: { tags: ['Breaks'], summary: 'End the active break; stays active (not closed) if outside the office geofence', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, clientTimestamp: { type: 'string', format: 'date-time' } } }), responses: { '200': okResponse({ type: 'object' }), ...errorResponses } } },

    '/tenant/alerts': { get: { tags: ['Alerts & Notifications'], summary: 'Timing/fraud alerts (break overstay, geofence exit, etc.) — requires alerts.receive', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { alerts: { type: 'array', items: { type: 'object' } } } }), ...errorResponses } } },
    '/tenant/alerts/action': { post: { tags: ['Alerts & Notifications'], summary: 'Accept or reject an alert', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['alertId', 'action'], properties: { alertId: { type: 'integer' }, action: { type: 'string', enum: ['accept', 'reject'] } } }), responses: { '200': okResponse({ type: 'object', properties: { success: { type: 'boolean' } } }), ...errorResponses } } },
    '/tenant/holidays': {
      get: { tags: ['Tenant Admin'], summary: 'List the holiday calendar', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { holidays: { type: 'array', items: { type: 'object' } } } }) } },
      post: { tags: ['Tenant Admin'], summary: 'Add a holiday (tenant_admin only)', security: [bearerAuth], requestBody: jsonBody({ type: 'object', required: ['date', 'name'], properties: { date: { type: 'string', example: 'YYYY-MM-DD' }, name: { type: 'string' } } }), responses: { '200': okResponse({ type: 'object' }), ...errorResponses } },
    },
    '/tenant/holidays/{id}': { delete: { tags: ['Tenant Admin'], summary: 'Remove a holiday (tenant_admin only)', security: [bearerAuth], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': okResponse({ type: 'object' }), ...errorResponses } } },

    '/tenant/ledger': { get: { tags: ['Audit Ledger'], summary: 'Immutable, SHA-256-hash-chained activity log (requires reports.view)', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { ledger: { type: 'array', items: { type: 'object' } } } }), ...errorResponses } } },
    '/tenant/ledger/verify': { post: { tags: ['Audit Ledger'], summary: 'Verify the hash chain has not been tampered with', security: [bearerAuth], responses: { '200': okResponse({ type: 'object', properties: { isValid: { type: 'boolean' }, invalidBlocks: { type: 'array', items: { type: 'integer' } }, verifiedBlocksCount: { type: 'integer' } } }), ...errorResponses } } },
  },
};
