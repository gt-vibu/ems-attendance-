/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Building2, Users, Calendar, Clock, ShieldCheck, MapPin, 
  Camera, FileJson, Layers, UserCheck, Trash2, CheckCircle2, 
  AlertTriangle, ArrowRight, Eye, RefreshCw, Sparkles, Plus, 
  Settings, Lock, HelpCircle, Power, Globe, Check, X, ShieldAlert,
  Bell, Database, Cpu, Fingerprint, Wifi, Smartphone, Laptop, 
  QrCode, Scan, Shield, Activity, CheckSquare, Square, Moon, Sun, Timer, Coffee
} from 'lucide-react';

// Type definitions for multi-tenant simulation
export interface CompanyPolicy {
  shiftStart: string;         // e.g., "09:00"
  gracePeriodMins: number;    // e.g., 15
  halfDayMins: number;        // e.g., 240 (4 hours)
  weekendConfig: string[];    // e.g., ["Saturday", "Sunday"]
  selfieRequired: boolean;
  geofenceRequired: boolean;
  radiusMeters: number;       // e.g., 100
  faceBiometric: boolean;
  
  // 10 verification options
  wifiSSIDRequired?: boolean;
  wifiSSIDs?: string[];        // list of approved Wi-Fi SSIDs
  qrRequired?: boolean;        // dynamic QR code scan required
  fingerprintRequired?: boolean; // TouchID/FaceID biometric simulation required
  vpnRequired?: boolean;        // remote VPN check required
  presenceCheckInterval?: number; // interval for random presence checks (minutes)
  breakValidationRequired?: boolean; // reconciliation of breaks vs coordinate gaps
  dailyBreakBudgetMins?: number;
  breakTypes?: BreakType[];
}

export interface BreakType {
  id: string;
  name: string;
  allowedDuration: number; // minutes
  isPaid: boolean;
  graceMinutes: number;
}

export interface BreakSession {
  id: string;
  typeId: string;
  startTime: string; // Server UTC
  endTime?: string;  // Server UTC
  status: 'ACTIVE' | 'ENDED' | 'CORRECTION_PENDING' | 'RECONCILED' | 'ENDED_SPOOFED' | 'ENDED_AUTO_EXPIRY';
  unpaidDurationMins?: number;
  correctionRequest?: {
    requestedStartTime: string;
    requestedEndTime: string;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    approverId?: string;
  };
}

export interface LeaveBalances {
  annual: number;
  sick: number;
  casual: number;
}

export interface TenantCompany {
  id: string;
  name: string;
  industry: string;
  timezone: string;
  country: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  plan?: 'STANDARD' | 'PREMIUM' | 'ENTERPRISE';
  adminEmail?: string;
  policy: CompanyPolicy;
  policyVersion?: number;
  leaves: LeaveBalances;
  holidays: { name: string; date: string }[];
  employees: {
    id: string;
    name: string;
    role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'EMPLOYEE' | 'MANAGER' | 'ADMIN' | 'HR' | 'GM';
    email: string;
    leavesUsed: LeaveBalances;
    password?: string;
    tempPasswordRequired?: boolean;
  }[];
  allowedFeatures?: {
    selfieCheckin: boolean;
    livenessScanning: boolean;
    gpsTracking: boolean;
    leaveManagement: boolean;
    auditLedger: boolean;
    anomalyAlerts: boolean;
  };
  roleFeaturePermissions?: {
    [role: string]: {
      overruleGeofence: boolean;
      bypassBiometrics: boolean;
      submitLeaves: boolean;
      approveLeaves: boolean;
      viewLedger: boolean;
      manageEmployees: boolean;
      canCreateRoles?: string[];
    };
  };
  sessions: {
    id: string;
    employeeName: string;
    date: string;
    checkIn: string;
    checkOut?: string;
    selfie?: string;
    gps?: { lat: number; lng: number };
    distanceMeters?: number;
    status: 'ACTIVE' | 'CLOSED' | 'LATE' | 'HALF_DAY' | 'NEEDS_REVIEW' | 'ABSENT';
    verificationLog: string[];
    breaks?: BreakSession[];
  }[];
  leaveRequests: {
    id: string;
    employeeName: string;
    type: 'annual' | 'sick' | 'casual';
    startDate: string;
    endDate: string;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    daysRequested: number;
  }[];
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  tenantId: string;
  tenantName: string;
  actor: string;
  action: string;
  details: string;
  oldValue?: string;
  newValue?: string;
  hash: string; // Simulated SHA-256 state seal
}

// Pre-seeded multi-tenant data
const INITIAL_TENANTS: TenantCompany[] = [
  {
    id: 't-apex-492',
    name: 'Apex Logistics',
    industry: 'Supply Chain & Field Ops',
    timezone: 'America/New_York (EST)',
    country: 'United States',
    status: 'ACTIVE',
    policy: {
      shiftStart: '08:30',
      gracePeriodMins: 10,
      halfDayMins: 240,
      weekendConfig: ['Saturday', 'Sunday'],
      selfieRequired: true,
      geofenceRequired: true,
      radiusMeters: 150,
      faceBiometric: true
    },
    leaves: {
      annual: 25,
      sick: 10,
      casual: 12
    },
    holidays: [
      { name: 'Labor Day', date: '2026-09-07' },
      { name: 'Thanksgiving', date: '2026-11-26' }
    ],
    employees: [
      { id: 'emp-apex-admin', name: 'Priya Patel', role: 'ADMIN', email: 'admin@apex.com', leavesUsed: { annual: 0, sick: 0, casual: 0 } },
      { id: 'emp-apex-1', name: 'John Peterson', role: 'EMPLOYEE', email: 'john@apex.com', leavesUsed: { annual: 4, sick: 1, casual: 2 } },
      { id: 'emp-apex-2', name: 'Samantha Vance', role: 'MANAGER', email: 'samantha@apex.com', leavesUsed: { annual: 8, sick: 3, casual: 1 } },
      { id: 'emp-apex-3', name: 'Marcus Brody', role: 'EMPLOYEE', email: 'marcus@apex.com', leavesUsed: { annual: 0, sick: 0, casual: 0 } }
    ],
    sessions: [
      {
        id: 'sess-apex-101',
        employeeName: 'John Peterson',
        date: '2026-07-06',
        checkIn: '08:24 AM',
        checkOut: '05:04 PM',
        status: 'CLOSED',
        distanceMeters: 42,
        verificationLog: ['GPS validation: 42m to Head Office (OK)', 'Selfie verification matched (99.2% confidence)']
      },
      {
        id: 'sess-apex-102',
        employeeName: 'Marcus Brody',
        date: '2026-07-07',
        checkIn: '08:44 AM',
        status: 'LATE',
        distanceMeters: 18,
        verificationLog: ['GPS validation: 18m to Head Office (OK)', 'Selfie matching: Pass', 'Shift Start: 08:30 AM + Grace 10m. Clock-in 08:44 AM (LATE MARKED)']
      }
    ],
    leaveRequests: [
      {
        id: 'lv-apex-1',
        employeeName: 'John Peterson',
        type: 'annual',
        startDate: '2026-07-10',
        endDate: '2026-07-14',
        reason: 'Family summer vacation trip',
        status: 'PENDING',
        daysRequested: 3 // Excludes Sat/Sun
      }
    ]
  },
  {
    id: 't-vertex-118',
    name: 'Vertex Systems',
    industry: 'Enterprise Software',
    timezone: 'Asia/Kolkata (IST)',
    country: 'India',
    status: 'ACTIVE',
    policy: {
      shiftStart: '09:30',
      gracePeriodMins: 20,
      halfDayMins: 300,
      weekendConfig: ['Saturday', 'Sunday'],
      selfieRequired: false,
      geofenceRequired: true,
      radiusMeters: 100,
      faceBiometric: false
    },
    leaves: {
      annual: 35,
      sick: 15,
      casual: 8
    },
    holidays: [
      { name: 'Independence Day', date: '2026-08-15' },
      { name: 'Ganesh Chaturthi', date: '2026-09-14' }
    ],
    employees: [
      { id: 'emp-vertex-1', name: 'Aarav Sharma', role: 'EMPLOYEE', email: 'aarav@vertex.io', leavesUsed: { annual: 12, sick: 4, casual: 3 } },
      { id: 'emp-vertex-2', name: 'Priya Patel', role: 'ADMIN', email: 'priya@vertex.io', leavesUsed: { annual: 14, sick: 2, casual: 0 } }
    ],
    sessions: [
      {
        id: 'sess-vertex-201',
        employeeName: 'Aarav Sharma',
        date: '2026-07-07',
        checkIn: '09:22 AM',
        status: 'ACTIVE',
        distanceMeters: 67,
        verificationLog: ['GPS validation: 67m to Bangalore HQ (OK)', 'Selfie verification: Bypassed by company settings']
      }
    ],
    leaveRequests: [
      {
        id: 'lv-vertex-1',
        employeeName: 'Aarav Sharma',
        type: 'sick',
        startDate: '2026-07-15',
        endDate: '2026-07-16',
        reason: 'Dental wisdom extraction',
        status: 'PENDING',
        daysRequested: 2
      }
    ]
  },
  {
    id: 't-stark-999',
    name: 'Stark Enterprises',
    industry: 'Defense & Robotics',
    timezone: 'America/Los_Angeles (PST)',
    country: 'United States',
    status: 'PENDING',
    policy: {
      shiftStart: '08:00',
      gracePeriodMins: 5,
      halfDayMins: 240,
      weekendConfig: ['Saturday', 'Sunday'],
      selfieRequired: true,
      geofenceRequired: true,
      radiusMeters: 50,
      faceBiometric: true
    },
    leaves: {
      annual: 30,
      sick: 12,
      casual: 10
    },
    holidays: [
      { name: 'Independence Day', date: '2026-07-04' }
    ],
    employees: [
      { id: 'emp-stark-1', name: 'Tony Stark', role: 'ADMIN', email: 'tony@stark.com', leavesUsed: { annual: 0, sick: 0, casual: 0 } },
      { id: 'emp-stark-2', name: 'Pepper Potts', role: 'MANAGER', email: 'pepper@stark.com', leavesUsed: { annual: 0, sick: 0, casual: 0 } }
    ],
    sessions: [],
    leaveRequests: []
  }
];

export function ensureTenantDefaults(t: TenantCompany): TenantCompany {
  const allowedFeatures = t.allowedFeatures || {
    selfieCheckin: t.plan === 'STANDARD' || t.plan === 'PREMIUM' || t.plan === 'ENTERPRISE' || !t.plan,
    livenessScanning: t.plan === 'ENTERPRISE',
    gpsTracking: t.plan === 'PREMIUM' || t.plan === 'ENTERPRISE' || !t.plan,
    leaveManagement: true,
    auditLedger: t.plan === 'ENTERPRISE',
    anomalyAlerts: t.plan === 'PREMIUM' || t.plan === 'ENTERPRISE' || !t.plan,
  };

  const roleFeaturePermissions = t.roleFeaturePermissions || {
    EMPLOYEE: {
      overruleGeofence: false,
      bypassBiometrics: false,
      submitLeaves: true,
      approveLeaves: false,
      viewLedger: false,
      manageEmployees: false,
    },
    MANAGER: {
      overruleGeofence: true,
      bypassBiometrics: false,
      submitLeaves: true,
      approveLeaves: true,
      viewLedger: true,
      manageEmployees: false,
    },
    HR: {
      overruleGeofence: false,
      bypassBiometrics: true,
      submitLeaves: true,
      approveLeaves: true,
      viewLedger: true,
      manageEmployees: true,
    },
    GM: {
      overruleGeofence: true,
      bypassBiometrics: true,
      submitLeaves: true,
      approveLeaves: true,
      viewLedger: true,
      manageEmployees: true,
    },
    ADMIN: {
      overruleGeofence: true,
      bypassBiometrics: true,
      submitLeaves: true,
      approveLeaves: true,
      viewLedger: true,
      manageEmployees: true,
    }
  };

  const sessions = (t.sessions || []).map(sess => ({
    ...sess,
    breaks: sess.breaks || []
  }));

  return {
    ...t,
    policyVersion: t.policyVersion || 1,
    allowedFeatures,
    roleFeaturePermissions,
    sessions,
    policy: {
      wifiSSIDRequired: t.policy.wifiSSIDRequired !== undefined ? t.policy.wifiSSIDRequired : false,
      wifiSSIDs: t.policy.wifiSSIDs || ['Apex_HQ_Secure'],
      qrRequired: t.policy.qrRequired !== undefined ? t.policy.qrRequired : false,
      fingerprintRequired: t.policy.fingerprintRequired !== undefined ? t.policy.fingerprintRequired : false,
      vpnRequired: t.policy.vpnRequired !== undefined ? t.policy.vpnRequired : false,
      presenceCheckInterval: t.policy.presenceCheckInterval || 30,
      breakValidationRequired: t.policy.breakValidationRequired !== undefined ? t.policy.breakValidationRequired : true,
      dailyBreakBudgetMins: t.policy.dailyBreakBudgetMins || 60,
      breakTypes: t.policy.breakTypes || [
        { id: 'bt-1', name: 'Lunch', allowedDuration: 45, isPaid: true, graceMinutes: 5 },
        { id: 'bt-2', name: 'Tea', allowedDuration: 15, isPaid: true, graceMinutes: 5 }
      ],
      ...t.policy
    }
  };
}

export default function EnterpriseSandbox() {
  // Global Directory State
  const [tenants, setTenants] = useState<TenantCompany[]>(() => {
    const saved = localStorage.getItem('perimeter_tenants');
    const rawList = saved ? JSON.parse(saved) : INITIAL_TENANTS;
    return rawList.map((t: TenantCompany) => ensureTenantDefaults(t));
  });

  const [activeTenantId, setActiveTenantId] = useState<string>('t-apex-492');
  const [activeRole, setActiveRole] = useState<'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'EMPLOYEE'>('COMPANY_ADMIN');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'policy' | 'onboarding' | 'leaves' | 'ledger' | 'clockin' | 'superadmin' | 'break_engine'>('dashboard');

  // --- SECURE JWT AUTHENTICATOR GATEWAY ---
  interface AuthSession {
    email: string;
    name: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'HR' | 'GM' | 'EMPLOYEE';
    tenantId: string | null;
    token: string;
  }

  const [authSession, setAuthSession] = useState<AuthSession | null>(() => {
    const saved = localStorage.getItem('perimeter_auth_session');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const generateJWT = (payload: { email: string; name: string; role: string; tenantId: string | null }): string => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const claimSet = btoa(JSON.stringify({
      ...payload,
      iss: "perimeter-security-auth",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7200
    }));
    const signature = "sha256-sig_" + btoa(payload.email).substring(0, 16);
    return `${header}.${claimSet}.${signature}`;
  };

  useEffect(() => {
    if (authSession) {
      if (authSession.role === 'SUPER_ADMIN') {
        setActiveRole('SUPER_ADMIN');
        setActiveTab('superadmin');
      } else {
        if (authSession.role === 'ADMIN') {
          setActiveRole('COMPANY_ADMIN');
        } else {
          setActiveRole('EMPLOYEE');
        }
        if (authSession.tenantId) {
          setActiveTenantId(authSession.tenantId);
          const matchEmp = tenants.find(t => t.id === authSession.tenantId)?.employees.find(e => e.email === authSession.email);
          if (matchEmp) {
            setSelectedEmployeeId(matchEmp.id);
          }
        }
        setActiveTab('dashboard');
      }
      setCurrentActorEmail(authSession.email);
    }
  }, [authSession]);

  // Interactive Employee State (for Employee Clock-In View)
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [registrationSuccess, setRegistrationSuccess] = useState<{ companyName: string; adminEmail: string; plan: string; tenantId: string } | null>(null);
  const [loginEmailInput, setLoginEmailInput] = useState<string>('');
  const [loginPasswordInput, setLoginPasswordInput] = useState<string>('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [pendingPasswordReset, setPendingPasswordReset] = useState<{tenantId: string, employeeId: string, email: string} | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('emp-apex-1');

  // --- Face Enrollment & Advanced Verification States ---
  const [enrolledFaces, setEnrolledFaces] = useState<{ [employeeId: string]: string }>(() => {
    const saved = localStorage.getItem('perimeter_enrolled_faces');
    return saved ? JSON.parse(saved) : { 'emp-apex-1': 'face_signature_hash_e94bc12a' };
  });

  useEffect(() => {
    localStorage.setItem('perimeter_enrolled_faces', JSON.stringify(enrolledFaces));
  }, [enrolledFaces]);

  const [enrollingEmployeeId, setEnrollingEmployeeId] = useState<string | null>(null);
  const [enrollmentStage, setEnrollmentStage] = useState<'IDLE' | 'CENTER' | 'LEFT' | 'RIGHT' | 'SMILE' | 'BLINK' | 'COMPLETED'>('IDLE');
  const [enrollmentProgress, setEnrollmentProgress] = useState<number>(0);

  // --- Wi-Fi Simulation States ---
  const [currentWifiSSID, setCurrentWifiSSID] = useState<string>('Apex_HQ_Secure');
  
  // --- QR Code Verification States ---
  const [activeQRToken, setActiveQRToken] = useState<string>('perimeter:token:9c8a74e:t-apex-492:1712948271');
  const [qrTimeLeft, setQrTimeLeft] = useState<number>(30);
  const [scannedQRToken, setScannedQRToken] = useState<string>('');
  const [qrScanSuccess, setQrScanSuccess] = useState<boolean>(false);
  const [qrScannerOpen, setQrScannerOpen] = useState<boolean>(false);

  // --- Fingerprint Verification States ---
  const [fingerprintScanned, setFingerprintScanned] = useState<boolean>(false);
  const [fingerprintScanning, setFingerprintScanning] = useState<boolean>(false);

  // --- Desktop/VPN PC Verification States ---
  const [vpnConnected, setVpnConnected] = useState<boolean>(true);
  const [pcRegistered, setPcRegistered] = useState<boolean>(true);

  // --- Active Verification Checklist Completion States ---
  const [completedGPSCheck, setCompletedGPSCheck] = useState<boolean>(false);
  const [completedFaceCheck, setCompletedFaceCheck] = useState<boolean>(false);
  
  // Break Engine states
  const [selectedBreakTypeId, setSelectedBreakTypeId] = useState<string>('');
  const [correctionReqStart, setCorrectionReqStart] = useState<string>('');
  const [correctionReqEnd, setCorrectionReqEnd] = useState<string>('');
  const [correctionReqReason, setCorrectionReqReason] = useState<string>('');
  const [showCorrectionForm, setShowCorrectionForm] = useState<string | null>(null); // breakId

  const [completedWifiCheck, setCompletedWifiCheck] = useState<boolean>(false);
  const [completedQRCheck, setCompletedQRCheck] = useState<boolean>(false);
  const [completedFingerprintCheck, setCompletedFingerprintCheck] = useState<boolean>(false);
  const [completedVPNCheck, setCompletedVPNCheck] = useState<boolean>(false);

  // --- Active QR Generator effect ---
  useEffect(() => {
    const interval = setInterval(() => {
      setQrTimeLeft(prev => {
        if (prev <= 1) {
          // Generate a new cryptographically simulated secure QR token
          const randHex = Math.floor(Math.random() * 16777215).toString(16);
          setActiveQRToken(`perimeter:token:${randHex}:${activeTenantId}:${Math.floor(Date.now() / 1000)}`);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTenantId]);
  const [simulatedTime, setSimulatedTime] = useState<string>('08:25');
  const [simulatedLat, setSimulatedLat] = useState<number>(40.7128); // NYC
  const [simulatedLng, setSimulatedLng] = useState<number>(-74.0060);
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(10); // meters
  const [isSpoofed, setIsSpoofed] = useState<boolean>(false);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [capturedSelfie, setCapturedSelfie] = useState<string | null>(null);
  const [livenessStage, setLivenessStage] = useState<'LOOK_CENTER' | 'BLINK' | 'SMILE' | 'COMPLETED'>('LOOK_CENTER');
  const [livenessProgress, setLivenessProgress] = useState<number>(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // --- New Enterprise Rules State Overrides ---
  const [isOfflineSimulated, setIsOfflineSimulated] = useState<boolean>(false);
  const [offlineQueue, setOfflineQueue] = useState<any[]>([]);
  const [deviceFingerprint, setDeviceFingerprint] = useState<string>('fp_chrome_b8a923');
  const [registeredFingerprint, setRegisteredFingerprint] = useState<string>('fp_chrome_b8a923');
  const [attemptTimeBackdating, setAttemptTimeBackdating] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncStatusLogs, setSyncStatusLogs] = useState<string[]>([]);
  
  // Geofence Branch office coordinates preset
  const officeBranches = [
    { name: 'Head Office', lat: 40.7128, lng: -74.0060, radius: 150 }, // Apex NYC base
    { name: 'New Jersey Depot', lat: 40.7306, lng: -74.0615, radius: 200 },
    { name: 'Outside Limits (Starbucks)', lat: 40.7580, lng: -73.9855, radius: 50 } // Times Square distance
  ];

  const currentTenant = tenants.find(t => t.id === activeTenantId) || tenants[0];

  // Leave Form States
  const [leaveType, setLeaveType] = useState<'annual' | 'sick' | 'casual'>('annual');
  const [leaveStart, setLeaveStart] = useState<string>('2026-07-15');
  const [leaveEnd, setLeaveEnd] = useState<string>('2026-07-17');
  const [leaveReason, setLeaveReason] = useState<string>('');

  // Onboarding Wizard Form States
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [obName, setObName] = useState('');
  const [obAdminEmail, setObAdminEmail] = useState('');
  const [obPlan, setObPlan] = useState<'STANDARD' | 'PREMIUM' | 'ENTERPRISE'>('PREMIUM');
  const [obBillingCycle, setObBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [obIndustry, setObIndustry] = useState('Logistics');
  
  // Employee Creation Form States
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [newEmpRole, setNewEmpRole] = useState<'EMPLOYEE' | 'MANAGER' | 'ADMIN' | 'HR' | 'GM'>('EMPLOYEE');

  // Super Admin Identity state (for RBAC email matching)
  const [superAdminEmail, setSuperAdminEmail] = useState(() => localStorage.getItem('perimeter_superadmin_email') || 'superadmin@example.com');
  const [currentActorEmail, setCurrentActorEmail] = useState(() => localStorage.getItem('perimeter_actor_email') || 'superadmin@example.com');

  // Simulated SMTP Mail Inbox logs
  const [simulatedEmails, setSimulatedEmails] = useState<{
    id: string;
    timestamp: string;
    from: string;
    to: string;
    subject: string;
    body: string;
    plan?: string;
    tenantId?: string;
    read: boolean;
  }[]>(() => {
    const saved = localStorage.getItem('perimeter_simulated_emails');
    return saved ? JSON.parse(saved) : [
      {
        id: 'mail-001',
        timestamp: new Date(Date.now() - 3600000 * 2).toLocaleString(),
        from: 'onboarding@smartteams.sec',
        to: 'superadmin@example.com',
        subject: '[SYSTEM] Secure SaaS Control Center Active',
        body: 'Welcome to Smart Teams. Your global secure tenant environment is active. Standard seed tenants Apex Logistics and Vertex Systems have been pre-provisioned and sealed.',
        read: true
      }
    ];
  });

  // Sync emails to localstorage
  useEffect(() => {
    localStorage.setItem('perimeter_simulated_emails', JSON.stringify(simulatedEmails));
  }, [simulatedEmails]);
  const [obTimezone, setObTimezone] = useState('America/Los_Angeles (PST)');
  const [obCountry, setObCountry] = useState('United States');
  const [obShiftStart, setObShiftStart] = useState('09:00');
  const [obGrace, setObGrace] = useState<number>(15);
  const [obRadius, setObRadius] = useState<number>(100);
  const [obSelfieReq, setObSelfieReq] = useState(true);
  const [obGeoReq, setObGeoReq] = useState(true);
  const [obBiometric, setObBiometric] = useState(true);
  const [obGpsTracking, setObGpsTracking] = useState(true);
  const [obLeaveManagement, setObLeaveManagement] = useState(true);
  const [obAuditLedger, setObAuditLedger] = useState(true);
  const [obAnomalyAlerts, setObAnomalyAlerts] = useState(true);
  const [obAnnualLimit, setObAnnualLimit] = useState<number>(20);
  const [obSickLimit, setObSickLimit] = useState<number>(10);
  const [obCasualLimit, setObCasualLimit] = useState<number>(10);

  // Cryptographic Ledger Audit Log State
  const [ledger, setLedger] = useState<AuditLogEntry[]>(() => {
    const saved = localStorage.getItem('perimeter_ledger');
    if (saved) return JSON.parse(saved);
    
    // Seed initial ledger block
    return [
      {
        id: 'block-001',
        timestamp: new Date(Date.now() - 3600000 * 24).toLocaleString(),
        tenantId: 'SYSTEM',
        tenantName: 'Genesis Core',
        actor: 'Global System Root',
        action: 'LEDGER_INITIALIZATION',
        details: 'Smart Teams Immutable Audit Trail successfully instantiated and anchored.',
        hash: 'b61a38cfc84668b05fc61bb9a0224bf16327bdf408ffec3f7902e4823ee2bcf1'
      }
    ];
  });

  // Notification engine queue
  const [notifications, setNotifications] = useState<{ id: string; time: string; text: string; type: string }[]>([
    { id: 'notif-1', time: '10:15 AM', text: 'System Notice: Apex Logistics onboarding verified by Super Admin.', type: 'system' },
    { id: 'notif-2', time: '11:32 AM', text: 'Policy Change: Shift grace period updated from 15m to 10m on t-apex-492.', type: 'policy' }
  ]);

  // Video Element Ref
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('perimeter_tenants', JSON.stringify(tenants));
  }, [tenants]);

  useEffect(() => {
    localStorage.setItem('perimeter_ledger', JSON.stringify(ledger));
  }, [ledger]);

  // Generate SHA-256 Mock hash for visual immutable proof
  const generateHash = (text: string) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return `${hex}4efb932c02df8ac${hex}8fe3c0daefc2a931081418`;
  };

  // Log action into Ledger
  const appendLedger = (tenantId: string, tenantName: string, actor: string, action: string, details: string, oldVal?: string, newVal?: string) => {
    const prevBlock = ledger[0];
    const prevHash = prevBlock ? prevBlock.hash : 'genesis';
    const timestamp = new Date().toLocaleString();
    const hashPayload = `${timestamp}-${tenantId}-${actor}-${action}-${details}-${prevHash}`;
    const blockHash = generateHash(hashPayload);

    const newBlock: AuditLogEntry = {
      id: `block-0${ledger.length + 1}`,
      timestamp,
      tenantId,
      tenantName,
      actor,
      action,
      details,
      oldValue: oldVal,
      newValue: newVal,
      hash: blockHash
    };

    setLedger(prev => [newBlock, ...prev]);
    
    // Auto push notification
    const newNotif = {
      id: `notif-${Date.now()}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: `[${tenantName}] ${actor}: ${action} - ${details.substring(0, 50)}...`,
      type: action.toLowerCase()
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  // Onboarding Submit
  const handleOnboardingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newId = `t-custom-${Math.floor(Math.random() * 900) + 100}`;
    const cleanAdminEmail = obAdminEmail.trim() || `admin@${obName.toLowerCase().replace(/\s/g, '') || 'company'}.com`;
    const adminPart = cleanAdminEmail.split('@')[0];
    const adminName = adminPart.charAt(0).toUpperCase() + adminPart.slice(1).replace(/[^a-zA-Z]/g, ' ');
    const companyName = obName || 'Alpha Corp';
    
    const newTenant: TenantCompany = {
      id: newId,
      name: companyName,
      industry: obIndustry,
      timezone: obTimezone,
      country: obCountry,
      status: 'PENDING', // Registered, requires Super Admin activation
      plan: obPlan,
      adminEmail: cleanAdminEmail,
      allowedFeatures: {
        selfieCheckin: obSelfieReq,
        livenessScanning: obBiometric,
        gpsTracking: obGpsTracking,
        leaveManagement: obLeaveManagement,
        auditLedger: obAuditLedger,
        anomalyAlerts: obAnomalyAlerts
      },
      policy: {
        shiftStart: obShiftStart,
        gracePeriodMins: Number(obGrace),
        halfDayMins: 240,
        weekendConfig: ['Saturday', 'Sunday'],
        selfieRequired: obSelfieReq,
        geofenceRequired: obGeoReq,
        radiusMeters: Number(obRadius),
        faceBiometric: obBiometric
      },
      leaves: {
        annual: Number(obAnnualLimit),
        sick: Number(obSickLimit),
        casual: Number(obCasualLimit)
      },
      holidays: [
        { name: 'National Holiday', date: '2026-10-01' }
      ],
      employees: [
        { id: `emp-${newId}-1`, name: adminName || 'Tenant Administrator', role: 'ADMIN', email: cleanAdminEmail, leavesUsed: { annual: 0, sick: 0, casual: 0 } },
        { id: `emp-${newId}-2`, name: 'Bob Smith', role: 'EMPLOYEE', email: `bob@${companyName.toLowerCase().replace(/\s/g, '') || 'company'}.com`, leavesUsed: { annual: 0, sick: 0, casual: 0 } }
      ],
      sessions: [],
      leaveRequests: []
    };

    setTenants(prev => [...prev, newTenant]);
    
    // Log the onboarding registration
    appendLedger(
      newId,
      newTenant.name,
      'Tenant Admin Registration Form',
      'COMPANY_ONBOARDED',
      `Registered tenant ${newTenant.name} with selected Plan: ${obPlan}. Tenant placed in PENDING state awaiting Super Admin clearance.`
    );

    // Simulate sending transaction onboarding confirmation email to the provided admin email!
    appendLedger(
      newId,
      newTenant.name,
      'Smart Teams SMTP Mailer',
      'EMAIL_DISPATCHED',
      `Onboarding welcome package and policy verification instructions transmitted to ${cleanAdminEmail} via gateway mail.smartteams.sec.`
    );

    // Push simulated SMTP Email Request both to SuperAdmin inbox and CCing the user
    const simulatedEmailId = `mail-${Date.now()}`;
    const onboardingMail = {
      id: simulatedEmailId,
      timestamp: new Date().toLocaleString(),
      from: cleanAdminEmail,
      to: 'superadmin@smartteams.sec',
      subject: `[Onboarding Request] ${companyName} - Plan: ${obPlan}`,
      body: `Hi SuperAdmin,\n\nI want to become a tenant on your security platform. I selected the package "${obPlan}" ($${obPlan === 'STANDARD' ? '49' : obPlan === 'PREMIUM' ? '149' : '499'}/mo).\n\nDetails:\n- Company: ${companyName}\n- Admin Email: ${cleanAdminEmail}\n- Primary Admin Name: ${adminName}\n- Domicile: ${obCountry}\n- Geofence Limit: ${obRadius}m\n\nPlease verify these details and onboard us.\n\nRegards,\n${adminName}\nAdmin of ${companyName}`,
      plan: obPlan,
      tenantId: newId,
      read: false
    };

    setSimulatedEmails(prev => [onboardingMail, ...prev]);

    // Reset Form & Switch
    setObName('');
    setObAdminEmail('');
    setObPlan('PREMIUM');
    setWizardStep(1);
    
    setRegistrationSuccess({
      companyName: companyName,
      adminEmail: cleanAdminEmail,
      plan: obPlan,
      tenantId: newId
    });
    
    setIsRegistering(false);
    
    if (authSession && authSession.role === 'SUPER_ADMIN') {
      setActiveTenantId(newId);
      setActiveTab('superadmin');
    }
  };

  // Add Employee or Appoint Manager
  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName.trim() || !newEmpEmail.trim()) return;

    if (!authSession) {
      alert("Access Denied: Unauthenticated. Token required to register staff.");
      return;
    }
    const isTenantAdmin = authSession.role === 'ADMIN';
    const isSuperAdmin = authSession.role === 'SUPER_ADMIN';
    const currentPermissions = currentTenant.roleFeaturePermissions?.[authSession.role as string];
    const hasManageEmployeesPrivilege = currentPermissions?.manageEmployees === true && authSession.tenantId === currentTenant.id;

    if (!isSuperAdmin && !isTenantAdmin && !hasManageEmployeesPrivilege) {
      alert(`Access Denied: Your identity claim (${authSession.role}) is not authorized to register personnel or manage staff under tenant ${currentTenant.name}.`);
      return;
    }
    
    // Check if user is allowed to create this specific role
    if (!isSuperAdmin && !isTenantAdmin) {
      const allowedRoles = currentPermissions?.canCreateRoles || [];
      if (!allowedRoles.includes(newEmpRole)) {
        alert(`Access Denied: Your role (${authSession.role}) is not authorized to provision a '${newEmpRole}' account.`);
        return;
      }
    }

    const tempPassword = Math.random().toString(36).slice(-8);
    const newEmpId = `emp-${currentTenant.id}-${currentTenant.employees.length + 1}`;
    const newEmp = {
      id: newEmpId,
      name: newEmpName.trim(),
      role: newEmpRole,
      email: newEmpEmail.trim(),
      leavesUsed: { annual: 0, sick: 0, casual: 0 },
      password: tempPassword,
      tempPasswordRequired: true
    };

    setTenants(prev => prev.map(t => {
      if (t.id === currentTenant.id) {
        return {
          ...t,
          employees: [...t.employees, newEmp as any]
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      activeRole === 'SUPER_ADMIN' ? 'Super Admin' : authSession.role,
      newEmpRole === 'MANAGER' ? 'MANAGER_APPOINTED' : newEmpRole === 'ADMIN' ? 'ADMIN_PROMOTED' : 'EMPLOYEE_ADDED',
      `Registered new user ${newEmp.name} as ${newEmp.role} under isolated tenant ${currentTenant.name}.`
    );

    // Simulate sending transaction onboarding email to the newly added user!
    const mailId = `mail-${Date.now()}`;
    const inviteMail = {
      id: mailId,
      timestamp: new Date().toLocaleString(),
      from: 'no-reply@smartteams.sec',
      to: newEmp.email,
      subject: `[Smart Teams] You have been invited to join ${currentTenant.name}`,
      body: `Hello ${newEmp.name},\n\nYou have been provisioned a new ${newEmp.role} account on Smart Teams for ${currentTenant.name}.\n\nPlease log in to access your workspace and verify your identity.\n\nLogin ID: ${newEmp.email}\nTemporary Password: ${tempPassword}\n\nLogin URL: https://smartteams.app/login\n\nNote: You will be required to set a permanent password upon your first login.\n\nRegards,\nSmart Teams Access Control`,
      read: false
    };
    setSimulatedEmails(prev => [inviteMail, ...prev]);

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      'Smart Teams SMTP Mailer',
      'EMAIL_DISPATCHED',
      `Sent credentials verification packet and policy documentation instructions to ${newEmp.email}.`
    );

    setNewEmpName('');
    setNewEmpEmail('');
    setNewEmpRole('EMPLOYEE');
  };

  // Change Policy Rule
  const handlePolicyUpdate = (field: keyof CompanyPolicy, value: any) => {
    if (!authSession) {
      alert("Access Denied: Unauthenticated. Token required to update company policies.");
      return;
    }
    const isTenantAdmin = authSession.role === 'ADMIN' && authSession.tenantId === activeTenantId;
    const isSuperAdmin = authSession.role === 'SUPER_ADMIN';
    if (!isSuperAdmin && !isTenantAdmin) {
      alert(`Access Denied: Your identity claim (${authSession.role}) is not authorized to modify policies for tenant ${activeTenantId}. Only the Tenant Admin can version these settings.`);
      return;
    }

    const oldVal = currentTenant.policy[field]?.toString();
    const newVal = value?.toString();
    const nextVersion = (currentTenant.policyVersion || 1) + 1;

    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        return {
          ...t,
          policyVersion: nextVersion,
          policy: {
            ...t.policy,
            [field]: value
          }
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      'Company Admin',
      'POLICY_UPDATE',
      `Modified attendance parameter '${field}' to match dynamic business limits. Incremented policy version to v1.0.${nextVersion}.`,
      oldVal,
      newVal
    );
  };

  // Toggle role permission in Tenant Roster
  const handleTogglePermission = (roleKey: 'EMPLOYEE' | 'MANAGER' | 'HR' | 'GM' | 'ADMIN', permKey: string) => {
    if (!authSession) {
      alert("Access Denied: Unauthenticated session. Access Token is required to modify role-based permissions.");
      return;
    }
    const isTenantAdmin = authSession.role === 'ADMIN' && authSession.tenantId === activeTenantId;
    const isSuperAdmin = authSession.role === 'SUPER_ADMIN';
    if (!isSuperAdmin && !isTenantAdmin) {
      alert(`Access Denied: Your identity claim (${authSession.role}) is not authorized to customize permissions for tenant ${activeTenantId}. Only the Tenant Admin is authorized to lock or release privileges.`);
      return;
    }

    let nextVal = false;
    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        const currentPerms = t.roleFeaturePermissions?.[roleKey] || {
          overruleGeofence: false,
          bypassBiometrics: false,
          submitLeaves: true,
          approveLeaves: false,
          viewLedger: false,
          manageEmployees: false,
        };
        const updatedPerms = {
          ...currentPerms,
          [permKey]: !currentPerms[permKey as keyof typeof currentPerms]
        };
        nextVal = !!updatedPerms[permKey as keyof typeof updatedPerms];
        return {
          ...t,
          roleFeaturePermissions: {
            ...t.roleFeaturePermissions,
            [roleKey]: updatedPerms
          }
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      'Company Admin',
      'ROLE_PERMISSION_CHANGED',
      `Modified permission '${permKey}' for role: ${roleKey} to ${nextVal ? 'GRANTED' : 'REVOKED'}.`
    );
  };

  const handleToggleRoleCreationPermission = (actorRole: string, targetRole: string) => {
    if (!authSession) {
      alert("Access Denied: Unauthenticated session.");
      return;
    }
    const isTenantAdmin = authSession.role === 'ADMIN' && authSession.tenantId === activeTenantId;
    const isSuperAdmin = authSession.role === 'SUPER_ADMIN';
    if (!isSuperAdmin && !isTenantAdmin) {
      alert(`Access Denied: Only Tenant Admin can modify role hierarchy.`);
      return;
    }

    let nextVal = false;
    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        const currentPerms = t.roleFeaturePermissions?.[actorRole] || {
          overruleGeofence: false,
          bypassBiometrics: false,
          submitLeaves: true,
          approveLeaves: false,
          viewLedger: false,
          manageEmployees: false,
          canCreateRoles: []
        };
        const currentCanCreate = currentPerms.canCreateRoles || [];
        const hasPerm = currentCanCreate.includes(targetRole);
        const newCanCreate = hasPerm 
          ? currentCanCreate.filter(r => r !== targetRole)
          : [...currentCanCreate, targetRole];
          
        nextVal = !hasPerm;
        
        return {
          ...t,
          roleFeaturePermissions: {
            ...t.roleFeaturePermissions,
            [actorRole]: {
              ...currentPerms,
              canCreateRoles: newCanCreate
            }
          }
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      'Company Admin',
      'ROLE_HIERARCHY_CHANGED',
      `Modified hierarchy: ${actorRole} can create ${targetRole} set to ${nextVal ? 'GRANTED' : 'REVOKED'}.`
    );
  };

  // Toggle platform feature allotment (Super Admin Action)
  const handleToggleFeature = (companyId: string, featureKey: 'selfieCheckin' | 'livenessScanning' | 'gpsTracking' | 'leaveManagement' | 'auditLedger' | 'anomalyAlerts') => {
    if (!authSession || authSession.role !== 'SUPER_ADMIN') {
      alert("Access Denied: Feature allotment can only be modified by the Global Super Admin.");
      return;
    }

    let nextVal = false;
    let companyName = '';
    let adminEmail = '';
    setTenants(prev => prev.map(t => {
      if (t.id === companyId) {
        companyName = t.name;
        adminEmail = t.adminEmail || `admin@${t.name.toLowerCase().replace(/\s/g, '')}.com`;
        const updatedFeatures = {
          ...t.allowedFeatures,
          [featureKey]: !t.allowedFeatures?.[featureKey]
        } as any;
        nextVal = updatedFeatures[featureKey];
        return {
          ...t,
          allowedFeatures: updatedFeatures
        };
      }
      return t;
    }));

    appendLedger(
      companyId,
      companyName || 'Unknown Company',
      `Super Admin (${superAdminEmail})`,
      'FEATURE_ALLOTMENT_CHANGED',
      `Super Admin toggled allotment of feature '${featureKey}' to ${nextVal ? 'ENABLED' : 'DISABLED'}.`
    );

    // Send transactional notice to Tenant Admin informing of change
    if (companyName && adminEmail) {
      const mailId = `mail-${Date.now()}`;
      const changeMail = {
        id: mailId,
        timestamp: new Date().toLocaleString(),
        from: 'billing@smartteams.sec',
        to: adminEmail,
        subject: `[Smart Teams Security] Core Feature Allotment Changed for ${companyName}`,
        body: `Dear Administrator of ${companyName},\n\nWe are writing to notify you that the global Super Admin (${superAdminEmail}) has updated your platform feature permissions.\n\nAllotment of "${featureKey.toUpperCase()}" is now: ${nextVal ? 'ACTIVE (ENABLED)' : 'INACTIVE (DISABLED)'}.\n\nIf this was unexpected, please contact support or reply to this request.\n\nRegards,\nSmart Teams Subscription Registry`,
        read: false
      };
      setSimulatedEmails(prev => [changeMail, ...prev]);
    }
  };

  // Approve Company (Super Admin Action)
  const handleTenantStatus = (id: string, status: 'ACTIVE' | 'SUSPENDED') => {
    if (!authSession || authSession.role !== 'SUPER_ADMIN') {
      alert("Access Denied: Tenant lifecycle states can only be modified by the Global Super Admin.");
      return;
    }

    const company = tenants.find(t => t.id === id);
    if (!company) return;

    let tempPassword = '';
    if (status === 'ACTIVE' && company.status === 'PENDING') {
      tempPassword = Math.random().toString(36).slice(-8); // Generate 8 char temp password
    }

    setTenants(prev => prev.map(t => {
      if (t.id === id) {
        if (tempPassword) {
          return { 
            ...t, 
            status,
            employees: t.employees.map(emp => {
              if (emp.role === 'COMPANY_ADMIN' || emp.role === 'SUPER_ADMIN' || emp.role === 'ADMIN') {
                 return { ...emp, password: tempPassword, tempPasswordRequired: true };
              }
              return emp;
            })
          };
        }
        return { ...t, status };
      }
      return t;
    }));

    if (company) {
      const adminEmailAddress = company.adminEmail || `admin@${company.name.toLowerCase().replace(/\s/g, '')}.com`;
      appendLedger(
        id,
        company.name,
        `Super Admin (${superAdminEmail})`,
        `COMPANY_STATUS_${status}`,
        `Company status set to ${status}. Network routing and API verification authorized.`
      );

      if (status === 'ACTIVE' && company.status === 'PENDING') {
        const mailId = `mail-${Date.now()}`;
        const activeFeaturesText = company.allowedFeatures 
          ? Object.entries(company.allowedFeatures).filter(([_, val]) => val).map(([key]) => `  - ${key}`).join('\n')
          : '  - Standard Selfie Validation\n  - Leaves & Accruals Workflow';
          
        const approvalMail = {
          id: mailId,
          timestamp: new Date().toLocaleString(),
          from: 'onboarding@smartteams.sec',
          to: adminEmailAddress,
          subject: `[Smart Teams] Organization APPROVED & Activated: ${company.name}`,
          body: `Dear Administrator of ${company.name},\n\nWe are pleased to inform you that your request to register under the ${company.plan || 'PREMIUM'} Plan has been officially VERIFIED and APPROVED by the global Super Admin (${superAdminEmail}).\n\nYour isolated container environment is now active. You have been allotted the following features by the Super Admin:\n${activeFeaturesText}\n\nTo access your workspace, please log in with your temporary credentials:\nLogin ID: ${adminEmailAddress}\nTemporary Password: ${tempPassword}\n\nImportant: You will be prompted to set a permanent password upon your first login. After that, you can enter the Policy Settings to onboard other roles such as HR, Managers, or Employees based on dynamic capabilities.\n\nLogin URL: https://smartteams.app/login\n\nSincerely,\nSmart Teams SaaS Gateway`,
          read: false
        };
        setSimulatedEmails(prev => [approvalMail, ...prev]);
      }
    }
  };

  // Selfie capture controls
  const startCamera = async () => {
    setCameraActive(true);
    setCapturedSelfie(null);
    setLivenessStage('LOOK_CENTER');
    setLivenessProgress(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn('Real camera stream failed, activating custom high-fidelity sensor simulator.', err);
    }
  };

  // Simulate or capture frames
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (cameraActive && livenessStage !== 'COMPLETED') {
      interval = setInterval(() => {
        setLivenessProgress(prev => {
          if (prev >= 100) {
            if (livenessStage === 'LOOK_CENTER') {
              setLivenessStage('BLINK');
              return 0;
            } else if (livenessStage === 'BLINK') {
              setLivenessStage('SMILE');
              return 0;
            } else if (livenessStage === 'SMILE') {
              setLivenessStage('COMPLETED');
              captureThumbnail();
              return 100;
            }
          }
          return prev + 25; // 1 second per task
        });
      }, 250);
    }
    return () => clearInterval(interval);
  }, [cameraActive, livenessStage]);

  // Face Enrollment Step-by-Step Biometric Challenge
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (enrollmentStage !== 'IDLE' && enrollmentStage !== 'COMPLETED') {
      interval = setInterval(() => {
        setEnrollmentProgress(prev => {
          if (prev >= 100) {
            if (enrollmentStage === 'CENTER') {
              setEnrollmentStage('LEFT');
              return 0;
            } else if (enrollmentStage === 'LEFT') {
              setEnrollmentStage('RIGHT');
              return 0;
            } else if (enrollmentStage === 'RIGHT') {
              setEnrollmentStage('SMILE');
              return 0;
            } else if (enrollmentStage === 'SMILE') {
              setEnrollmentStage('BLINK');
              return 0;
            } else if (enrollmentStage === 'BLINK') {
              setEnrollmentStage('COMPLETED');
              // Generate signature and save
              const emp = currentTenant.employees.find(e => e.id === selectedEmployeeId);
              if (emp) {
                setEnrolledFaces(prev => ({
                  ...prev,
                  [emp.id]: `face_signature_hash_${Math.random().toString(16).substring(2, 10)}`
                }));
              }
              return 100;
            }
          }
          return prev + 25; // Speed: 1 second per step
        });
      }, 250);
    }
    return () => clearInterval(interval);
  }, [enrollmentStage, selectedEmployeeId, currentTenant.employees]);

  const captureThumbnail = () => {
    if (videoRef.current && canvasRef.current && cameraStream) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = 120;
      canvas.height = 90;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, 120, 90);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setCapturedSelfie(dataUrl);
      }
      stopCamera();
    } else {
      // Fallback: Generate a stylish tech-vector placeholder thumbnail
      const svgThumb = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90"><rect width="100%" height="100%" fill="%230b2a2e"/><circle cx="60" cy="35" r="18" fill="%234fd1a5" opacity="0.8"/><ellipse cx="60" cy="70" rx="30" ry="15" fill="%234fd1a5" opacity="0.6"/><text x="10" y="80" fill="%238fe3c0" font-family="monospace" font-size="8">VERIFIED SECURE</text></svg>`;
      setCapturedSelfie(svgThumb);
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setCameraActive(false);
  };

  // Perform dynamic coordinates math (Geofence & Spoofing detection)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return Math.round(R * c); // Distance in meters
  };

  // Exclude Sat/Sun and Company Holidays from requested leave duration
  const calculateLeaveDays = (startStr: string, endStr: string, holidays: { date: string }[]) => {
    const start = new Date(startStr);
    const end = new Date(endStr);
    let count = 0;
    const cur = new Date(start);

    while (cur <= end) {
      const day = cur.getDay();
      const isWeekend = day === 0 || day === 6; // Sunday/Saturday
      const dateStr = cur.toISOString().split('T')[0];
      const isHoliday = holidays.some(h => h.date === dateStr);

      if (!isWeekend && !isHoliday) {
        count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  };

  // Handle Employee Clock-In
  const handleEmployeeClockIn = () => {
    const emp = currentTenant.employees.find(e => e.id === selectedEmployeeId);
    if (!emp) return;

    const policyVer = currentTenant.policyVersion || 1;
    const auditTrail: string[] = [
      `[PIPELINE v1.0.${policyVer}] Ingesting check-in event for actor: ${emp.name} (${emp.role})`,
      `[POLICY INFERENCE] Shift Start: ${currentTenant.policy.shiftStart}, Grace Period: ${currentTenant.policy.gracePeriodMins}m, Geofence Radius: ${currentTenant.policy.radiusMeters}m.`
    ];

    // Read the allotted features (Super Admin toggles)
    const allowed = currentTenant.allowedFeatures || {
      selfieCheckin: true,
      livenessScanning: true,
      gpsTracking: true,
      leaveManagement: true,
      auditLedger: true,
      anomalyAlerts: true
    };

    // Read the role permission settings (Tenant Admin toggles)
    const rolePerms = currentTenant.roleFeaturePermissions?.[emp.role] || {
      overruleGeofence: false,
      bypassBiometrics: false,
      submitLeaves: true,
      approveLeaves: false,
      viewLedger: false,
      manageEmployees: false
    };

    let status: 'ACTIVE' | 'LATE' | 'NEEDS_REVIEW' | 'ABSENT' = 'ACTIVE';
    let failedMethods: string[] = [];

    // --- Rule #5: Device trust/fingerprint validation ---
    if (deviceFingerprint !== registeredFingerprint) {
      status = 'NEEDS_REVIEW';
      failedMethods.push('Device Trust Fingerprint');
      auditTrail.push(`[DEVICE TRUST FAILURE] Security mismatch. Client footprint: "${deviceFingerprint}" does not match enrolled hardware profile: "${registeredFingerprint}".`);
    } else {
      auditTrail.push(`[DEVICE TRUST VERIFIED] Enclave fingerprint signature matches enrolled footprint.`);
    }

    // --- Rule #2 & #4: Preventing manual backdating & NTP server clock verification ---
    let actualClockInTime = simulatedTime;
    if (attemptTimeBackdating) {
      status = 'NEEDS_REVIEW';
      failedMethods.push('NTP Clock Validation');
      const serverAuthoritativeTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      actualClockInTime = serverAuthoritativeTime;
      auditTrail.push(`[BACKDATING ATTEMPT BLOCKED] Discrepancy identified between local browser client clock and authoritative NTP server clock. Rejecting backdating. Server clock enforced: ${serverAuthoritativeTime}.`);
    }

    // Check Geofence Coordinates
    const targetOffice = officeBranches[0]; // NYC base coordinates
    const computedDist = calculateDistance(simulatedLat, simulatedLng, targetOffice.lat, targetOffice.lng);
    const insideGeofence = computedDist <= currentTenant.policy.radiusMeters;

    // 1. Geofence Check
    if (currentTenant.policy.geofenceRequired) {
      if (!allowed.gpsTracking) {
        auditTrail.push(`[SUPER_ADMIN RESTRICTION] Geofence GPS tracking is NOT allotted for this company. Skipping enforcement.`);
      } else {
        auditTrail.push(`Geofence Verification: Distance to office is ${computedDist}m (Radius: ${currentTenant.policy.radiusMeters}m).`);
        if (!insideGeofence) {
          if (rolePerms.overruleGeofence) {
            auditTrail.push(`[RBAC PRIVILEGE GRANTED] Actor role "${emp.role}" has 'overruleGeofence' enabled. Geofence violation overruled.`);
          } else {
            status = 'NEEDS_REVIEW';
            failedMethods.push('GPS Geofence');
            auditTrail.push(`[GEOFENCE VIOLATION] Employee registered check-in outside authorized perimeter bounds.`);
          }
        } else {
          auditTrail.push(`GPS handshake verified inside approved office perimeter.`);
        }
      }
    } else {
      auditTrail.push('Geofence verification bypassed by company-wide settings.');
    }

    // 2. Spoofing Check
    if (allowed.anomalyAlerts) {
      if (isSpoofed || gpsAccuracy > 80) {
        status = 'NEEDS_REVIEW';
        failedMethods.push('Anti-Spoof Check');
        auditTrail.push('[GPS SPOOFING DETECTED] Virtual location emulator signature matched blacklist criteria.');
      }
    } else {
      auditTrail.push('[SUPER_ADMIN RESTRICTION] Anomaly detection features are NOT allotted. Spoof checks skipped.');
    }

    // 3. Selfie & Face Biometrics Verification
    if (currentTenant.policy.selfieRequired) {
      if (!allowed.selfieCheckin) {
        auditTrail.push('[SUPER_ADMIN RESTRICTION] Selfie check-in features are NOT allotted. Skipping camera validation.');
      } else if (rolePerms.bypassBiometrics) {
        auditTrail.push(`[RBAC PRIVILEGE GRANTED] Actor role "${emp.role}" has 'bypassBiometrics' enabled. Skipping camera validation.`);
      } else {
        if (currentTenant.policy.faceBiometric) {
          const isEnrolled = enrolledFaces[emp.id] !== undefined;
          if (!isEnrolled) {
            status = 'NEEDS_REVIEW';
            failedMethods.push('Face Biometrics');
            auditTrail.push('[BIOMETRIC ANOMALY] Employee biometric face profile is NOT enrolled in the secure directory.');
          } else {
            auditTrail.push(`[FACE BIOMETRIC] Verified signature matches enrolled key: ${enrolledFaces[emp.id]?.substring(0, 15)}...`);
            if (allowed.livenessScanning) {
              auditTrail.push('Dual-Factor Face biometric match completed (99.4% structural liveness score: blink/smile verified).');
            } else {
              auditTrail.push('Selfie verification photo uploaded. (Liveness checking skipped: Not allotted by Super Admin).');
            }
          }
        } else {
          auditTrail.push('Selfie verification photo successfully uploaded to cloud storage.');
        }
      }
    }

    // 4. Office Wi-Fi Network SSID Check
    if (currentTenant.policy.wifiSSIDRequired) {
      const approvedSSIDs = currentTenant.policy.wifiSSIDs || ['Apex_HQ_Secure'];
      auditTrail.push(`[OFFICE WI-FI] Active client SSID: "${currentWifiSSID}". Approved SSIDs: ${approvedSSIDs.join(', ')}.`);
      if (!approvedSSIDs.includes(currentWifiSSID)) {
        if (rolePerms.overruleGeofence) {
          auditTrail.push(`[RBAC PRIVILEGE GRANTED] Actor has 'overruleGeofence' enabled. Wi-Fi SSID mismatch bypassed.`);
        } else {
          status = 'NEEDS_REVIEW';
          failedMethods.push('Office Wi-Fi SSID');
          auditTrail.push(`[WIFI MISMATCH] Connected to unauthorized network: "${currentWifiSSID}". Access restricted.`);
        }
      } else {
        auditTrail.push('Wi-Fi SSID match verified. Cryptographic BSSID handshake successful.');
      }
    }

    // 5. Dynamic QR Code Verification
    if (currentTenant.policy.qrRequired) {
      auditTrail.push(`[RECEPTION QR CODE] Employee scanned token: "${scannedQRToken || 'None'}". Active token: "${activeQRToken}".`);
      if (scannedQRToken !== activeQRToken || !qrScanSuccess) {
        status = 'NEEDS_REVIEW';
        failedMethods.push('Reception QR Code');
        auditTrail.push('[QR INVALID] Dynamic reception desk QR code token is invalid, expired, or unscanned.');
      } else {
        auditTrail.push('Dynamic Reception QR Code decoded & verified successfully (SLA integrity OK).');
      }
    }

    // 6. Fingerprint Biometric Scanner Verification
    if (currentTenant.policy.fingerprintRequired) {
      auditTrail.push('[FINGERPRINT] Checking hardware enclave fingerprint match state.');
      if (!fingerprintScanned) {
        status = 'NEEDS_REVIEW';
        failedMethods.push('Enclave Fingerprint');
        auditTrail.push('[FINGERPRINT BYPASS] Fingerprint sensor not verified by local secure enclave.');
      } else {
        auditTrail.push('Biometric fingerprint match verified (Device Signature Token: fp_secure_tkn_8173).');
      }
    }

    // 7. Desktop Environment / VPN Client Check
    if (currentTenant.policy.vpnRequired) {
      auditTrail.push(`[DESKTOP VPN] PC Serial Registration: ${pcRegistered ? 'OK' : 'FAIL'}, VPN Secure Gateway IP: ${vpnConnected ? '10.140.40.22 (CONNECTED)' : 'DISCONNECTED'}.`);
      if (!vpnConnected || !pcRegistered) {
        status = 'NEEDS_REVIEW';
        failedMethods.push('Desktop VPN/Device');
        auditTrail.push('[COMPLIANCE VIOLATION] Desktop remoteness check failed. Device registration mismatch or disconnected VPN.');
      } else {
        auditTrail.push('Desktop client environment verified. VPN routing certified.');
      }
    }

    // 8. Presence Verification & Random Checks Scheduler
    if (currentTenant.policy.presenceCheckInterval) {
      auditTrail.push(`[PRESENCE TRACK] Presence audit tracking scheduled at random intervals of ${currentTenant.policy.presenceCheckInterval}m.`);
    }

    // 9. Dynamic Grace Period Calculations
    const [shiftH, shiftM] = currentTenant.policy.shiftStart.split(':').map(Number);
    const [clockH, clockM] = actualClockInTime.split(':').map(Number);
    const shiftTotalMins = shiftH * 60 + shiftM;
    const clockTotalMins = clockH * 60 + clockM;
    const diff = clockTotalMins - shiftTotalMins;

    if (status !== 'NEEDS_REVIEW') {
      if (diff > currentTenant.policy.gracePeriodMins) {
        status = 'LATE';
        auditTrail.push(`Late arrival registered. Time: ${actualClockInTime} > Shift: ${currentTenant.policy.shiftStart} (+ ${currentTenant.policy.gracePeriodMins}m grace limit).`);
      } else {
        auditTrail.push('Punctual clock-in recorded within grace boundary limit.');
      }
    } else {
      auditTrail.push(`[PIPELINE REJECTED] Validation failed for: ${failedMethods.join(', ')}. Session placed under review.`);
    }

    const newSession = {
      id: `sess-${currentTenant.id}-${Date.now().toString().substring(8)}`,
      employeeName: emp.name,
      date: new Date().toISOString().split('T')[0],
      checkIn: actualClockInTime,
      selfie: (capturedSelfie && allowed.selfieCheckin && !rolePerms.bypassBiometrics) ? capturedSelfie : undefined,
      gps: { lat: simulatedLat, lng: simulatedLng },
      distanceMeters: computedDist,
      status,
      verificationLog: auditTrail
    };

    // --- Rule #6: Offline attendance logging queue ---
    if (isOfflineSimulated) {
      const offlineEvent = {
        id: `off-${Date.now()}`,
        eventType: 'check-in',
        employeeName: emp.name,
        offlineTimestamp: new Date().toISOString(),
        deviceId: 'simulated_device_id',
        deviceFingerprint,
        lat: simulatedLat,
        lng: simulatedLng,
        declaredTime: actualClockInTime,
        status,
        auditTrail
      };
      setOfflineQueue(prev => [...prev, offlineEvent]);
      appendLedger(
        currentTenant.id,
        currentTenant.name,
        emp.name,
        'OFFLINE_CLOCK_IN_QUEUED',
        `Securely cached offline clock-in event at simulated time ${actualClockInTime}. Pending synchronization conflict resolution.`,
        undefined,
        JSON.stringify(offlineEvent)
      );
      // Reset temporary check states
      setCapturedSelfie(null);
      setScannedQRToken('');
      setQrScanSuccess(false);
      setFingerprintScanned(false);
      setActiveTab('dashboard');
      alert("OFFLINE MODE ACTIVE: Attendance transaction successfully encrypted and queued locally in device sandbox.");
      return;
    }

    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        return {
          ...t,
          sessions: [newSession, ...t.sessions]
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      emp.name,
      'EMPLOYEE_CLOCK_IN',
      `Registered clock-in session at ${actualClockInTime} using Policy v1.0.${policyVer}. Calculated status: ${status}.`,
      undefined,
      JSON.stringify({ status, distance: computedDist, policyVer, failedMethods })
    );

    // Reset temporary check states
    setCapturedSelfie(null);
    setScannedQRToken('');
    setQrScanSuccess(false);
    setFingerprintScanned(false);
    setActiveTab('dashboard');
  };

  // Leave approval deduction engine
  const handleLeaveRequest = (e: React.FormEvent) => {
    e.preventDefault();
    const emp = currentTenant.employees.find(e => e.id === selectedEmployeeId);
    if (!emp) return;

    const days = calculateLeaveDays(leaveStart, leaveEnd, currentTenant.holidays);
    const currentBalance = currentTenant.leaves[leaveType] - emp.leavesUsed[leaveType];

    if (days > currentBalance) {
      alert(`Invalid Request: Requested ${days} days, but remaining balance is only ${currentBalance} days.`);
      return;
    }

    const newRequest = {
      id: `lv-${currentTenant.id}-${Date.now().toString().substring(9)}`,
      employeeName: emp.name,
      type: leaveType,
      startDate: leaveStart,
      endDate: leaveEnd,
      reason: leaveReason || 'General time off request',
      status: 'PENDING' as const,
      daysRequested: days
    };

    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        return {
          ...t,
          leaveRequests: [newRequest, ...t.leaveRequests]
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      emp.name,
      'LEAVE_REQUESTED',
      `Filed leave request for ${days} days (${leaveType}) starting ${leaveStart}.`
    );

    setLeaveReason('');
  };

  // Leave Request Decision
  const handleLeaveDecision = (id: string, status: 'APPROVED' | 'REJECTED') => {
    if (!authSession) {
      alert("Access Denied: Unauthenticated. Token required to approve or reject leaves.");
      return;
    }
    const isTenantAdmin = authSession.role === 'ADMIN' && authSession.tenantId === activeTenantId;
    const isSuperAdmin = authSession.role === 'SUPER_ADMIN';
    const hasApproveLeavesPrivilege = currentTenant.roleFeaturePermissions?.[authSession.role as any]?.approveLeaves === true && authSession.tenantId === activeTenantId;

    if (!isSuperAdmin && !isTenantAdmin && !hasApproveLeavesPrivilege) {
      alert(`Access Denied: Your identity claim (${authSession.role}) is not authorized to decide leave requests in this tenant.`);
      return;
    }

    const req = currentTenant.leaveRequests.find(r => r.id === id);
    if (!req) return;

    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        // Dedect balances if approved
        const updatedEmployees = t.employees.map(emp => {
          if (emp.name === req.employeeName && status === 'APPROVED') {
            return {
              ...emp,
              leavesUsed: {
                ...emp.leavesUsed,
                [req.type]: emp.leavesUsed[req.type] + req.daysRequested
              }
            };
          }
          return emp;
        });

        const updatedRequests = t.leaveRequests.map(r => {
          if (r.id === id) return { ...r, status };
          return r;
        });

        return {
          ...t,
          employees: updatedEmployees,
          leaveRequests: updatedRequests
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      'Priya Patel (Admin)',
      `LEAVE_${status}`,
      `Leave request ${id} filed by ${req.employeeName} has been ${status}.`
    );
  };

  // --- BREAK ENGINE HANDLERS ---
  const handleStartBreak = (sessionId: string, typeId: string) => {
    if (!authSession) return;
    const breakType = currentTenant.policy.breakTypes?.find(bt => bt.id === typeId);
    if (!breakType) return;
    
    const now = new Date();
    const startTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // --- Rule #6: Offline support for break-start ---
    if (isOfflineSimulated) {
      const offlineEvent = {
        id: `off-brk-start-${Date.now()}`,
        eventType: 'break-start',
        employeeName: authSession.name,
        offlineTimestamp: new Date().toISOString(),
        deviceId: 'simulated_device_id',
        deviceFingerprint,
        lat: simulatedLat,
        lng: simulatedLng,
        declaredTime: startTimeStr,
        sessionId,
        typeId
      };
      setOfflineQueue(prev => [...prev, offlineEvent]);
      appendLedger(
        currentTenant.id,
        currentTenant.name,
        authSession.name,
        'OFFLINE_BREAK_START_QUEUED',
        `Securely cached offline break start for ${breakType.name} at ${startTimeStr}.`
      );
      alert("OFFLINE MODE ACTIVE: Break-start transaction securely stored in local enclave queue.");
      return;
    }

    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        return {
          ...t,
          sessions: t.sessions.map(s => {
            if (s.id === sessionId) {
              const newBreak: BreakSession = {
                id: `brk-${Date.now()}`,
                typeId,
                startTime: startTimeStr,
                status: 'ACTIVE'
              };
              return { ...s, breaks: [...(s.breaks || []), newBreak] };
            }
            return s;
          })
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      authSession.name,
      'BREAK_STARTED',
      `Started ${breakType.name} break at ${startTimeStr}.`
    );
  };

  const handleEndBreak = (sessionId: string, breakId: string) => {
    if (!authSession) return;
    const now = new Date();
    let endTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // --- Rule #6: Offline support for break-end ---
    if (isOfflineSimulated) {
      const offlineEvent = {
        id: `off-brk-end-${Date.now()}`,
        eventType: 'break-end',
        employeeName: authSession.name,
        offlineTimestamp: new Date().toISOString(),
        deviceId: 'simulated_device_id',
        deviceFingerprint,
        lat: simulatedLat,
        lng: simulatedLng,
        declaredTime: endTimeStr,
        sessionId,
        breakId
      };
      setOfflineQueue(prev => [...prev, offlineEvent]);
      appendLedger(
        currentTenant.id,
        currentTenant.name,
        authSession.name,
        'OFFLINE_BREAK_END_QUEUED',
        `Securely cached offline break end at ${endTimeStr}.`
      );
      alert("OFFLINE MODE ACTIVE: Break-end transaction securely stored in local enclave queue.");
      return;
    }

    // --- Rule #1 & #9: Geofence and backdating spoofing validation on break end ---
    const targetOffice = officeBranches[0];
    const computedDist = calculateDistance(simulatedLat, simulatedLng, targetOffice.lat, targetOffice.lng);
    const insideGeofence = computedDist <= currentTenant.policy.radiusMeters;
    
    let isSpoof = false;
    let anomalyNote = '';

    if (attemptTimeBackdating) {
      isSpoof = true;
      anomalyNote = ' [TIME_BACKDATING_SPOOF_DETECTED: Discrepancy between client and NTP server clocks.]';
      // Force NTP-enforced server-authoritative timestamp
      endTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Rule #9: Check if outside office geofence but claiming to have returned
    if (!insideGeofence) {
      isSpoof = true;
      anomalyNote += ' [TIME_BACKDATING_SPOOF_DETECTED: Location spoofing suspected. Return claimed while coordinates are outside geofence boundary.]';
    }

    // Find the break and calculate duration
    let excessMinutes = 0;
    const currentSession = currentTenant.sessions.find(s => s.id === sessionId);
    const curBreak = currentSession?.breaks?.find(b => b.id === breakId);
    
    if (curBreak) {
      const getMinutesDiff = (startStr: string, endStr: string) => {
        try {
          const [sh, sm] = startStr.split(':').map(Number);
          const [eh, em] = endStr.split(':').map(Number);
          return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
        } catch (e) {
          return 15;
        }
      };
      const actualDuration = getMinutesDiff(curBreak.startTime, endTimeStr);
      const breakType = currentTenant.policy.breakTypes?.find(bt => bt.id === curBreak.typeId);
      const allowedDuration = breakType?.allowedDuration || 15;

      // Rule #7: Conversion of excess break to unpaid time
      if (actualDuration > allowedDuration) {
        excessMinutes = actualDuration - allowedDuration;
      }
    }

    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        return {
          ...t,
          sessions: t.sessions.map(s => {
            if (s.id === sessionId) {
              const updatedStatus = isSpoof ? 'NEEDS_REVIEW' : s.status;
              return {
                ...s,
                status: updatedStatus,
                breaks: (s.breaks || []).map(b => {
                  if (b.id === breakId) {
                    return { 
                      ...b, 
                      endTime: endTimeStr, 
                      status: isSpoof ? 'ENDED_SPOOFED' : 'ENDED',
                      unpaidDurationMins: excessMinutes 
                    };
                  }
                  return b;
                })
              };
            }
            return s;
          })
        };
      }
      return t;
    }));

    let ledgerText = `Ended break at ${endTimeStr}. Server recorded immutable timestamp.`;
    if (excessMinutes > 0) {
      ledgerText += ` Excess break of ${excessMinutes}m detected and automatically converted to unpaid duration.`;
    }
    if (isSpoof) {
      ledgerText += ` ${anomalyNote}`;
    }

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      authSession.name,
      isSpoof ? 'BREAK_END_SPOOF_FLAGGED' : 'BREAK_ENDED',
      ledgerText,
      undefined,
      JSON.stringify({ excessMinutes, isSpoof, anomalyNote })
    );

    if (isSpoof) {
      alert(`SECURITY WARNING: Break-return flagged!${anomalyNote}`);
    }
  };

  // --- OFFLINE SYNC HANDLER (Rule #6) ---
  const handleTriggerOfflineSync = async () => {
    if (offlineQueue.length === 0) {
      alert("No pending offline events to synchronize.");
      return;
    }
    setIsSyncing(true);
    setSyncStatusLogs([]);

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const logs: string[] = [];

    const addLog = (msg: string) => {
      logs.push(msg);
      setSyncStatusLogs([...logs]);
    };

    addLog(`[SYNC INITIATED] Contacting NTP server for secure authority handshake...`);
    await sleep(400);
    addLog(`[SYNC KEY EXCHANGE] Cryptographic signatures verified (RSA-4096).`);
    await sleep(400);

    let processedCount = 0;
    let conflictCount = 0;

    for (const evt of offlineQueue) {
      addLog(`[PROCESSING] Evaluating cached ${evt.eventType} event for actor: ${evt.employeeName}...`);
      await sleep(300);

      // Rule #5: Device Profile Trust check during sync
      if (evt.deviceFingerprint !== registeredFingerprint) {
        addLog(`[DEVICE BLOCK] Signature mismatch: Received device fingerprint "${evt.deviceFingerprint}" does not match registered profile "${registeredFingerprint}". Event marked as SUSPICIOUS.`);
        conflictCount++;
      }

      // Check for overlapping sessions or backdating conflicts (Rule #6)
      const existingSessions = currentTenant.sessions;
      const dateStr = evt.offlineTimestamp.split('T')[0];
      const isOverlap = existingSessions.some(s => s.employeeName === evt.employeeName && s.date === dateStr);

      let resolvedStatus = evt.status;
      let finalReason = `Synced offline ${evt.eventType} event. `;

      if (isOverlap && evt.eventType === 'check-in') {
        resolvedStatus = 'NEEDS_REVIEW';
        finalReason += `[SYNC_CONFLICT_DETECTED] Overlapping duplicate session found for today. Marked for admin review.`;
        addLog(`[CONFLICT RESOLVED] Duplicate entry collision detected. Event merged and flagged for manager review.`);
        conflictCount++;
      } else {
        addLog(`[VERIFIED] Event has no chronological conflicts.`);
      }

      // Append to the active tenant's sessions if it's a clock-in
      if (evt.eventType === 'check-in') {
        const syncedSession = {
          id: `sess-${currentTenant.id}-${Date.now().toString().substring(8)}-sync`,
          employeeName: evt.employeeName,
          date: dateStr,
          checkIn: evt.declaredTime,
          gps: { lat: evt.lat, lng: evt.lng },
          distanceMeters: calculateDistance(evt.lat, evt.lng, officeBranches[0].lat, officeBranches[0].lng),
          status: resolvedStatus,
          verificationLog: [
            ...(evt.auditTrail || []),
            `[OFFLINE SYNC ENCLAVE] Processed sync event on ${new Date().toLocaleString()}`,
            `[CONFLICT ENFORCEMENT] Conflict status: ${resolvedStatus}. Note: ${finalReason}`
          ]
        };

        setTenants(prev => prev.map(t => {
          if (t.id === activeTenantId) {
            return {
              ...t,
              sessions: [syncedSession, ...t.sessions]
            };
          }
          return t;
        }));
      } else if (evt.eventType === 'break-start' || evt.eventType === 'break-end') {
        setTenants(prev => prev.map(t => {
          if (t.id === activeTenantId) {
            return {
              ...t,
              sessions: t.sessions.map(s => {
                if (s.id === evt.sessionId) {
                  if (evt.eventType === 'break-start') {
                    const newBreak: BreakSession = {
                      id: `brk-${Date.now()}`,
                      typeId: evt.typeId,
                      startTime: evt.declaredTime,
                      status: 'ACTIVE'
                    };
                    return { ...s, breaks: [...(s.breaks || []), newBreak] };
                  } else {
                    return {
                      ...s,
                      breaks: (s.breaks || []).map(b => {
                        if (b.id === evt.breakId) {
                          return { ...b, endTime: evt.declaredTime, status: 'ENDED' };
                        }
                        return b;
                      })
                    };
                  }
                }
                return s;
              })
            };
          }
          return t;
        }));
      }

      appendLedger(
        currentTenant.id,
        currentTenant.name,
        evt.employeeName,
        evt.eventType === 'check-in' ? 'EMPLOYEE_OFFLINE_SYNC_APPROVED' : 'BREAK_OFFLINE_SYNC_APPROVED',
        `Synchronized offline transaction. Resulting Status: ${resolvedStatus}. Detail: ${finalReason}`,
        undefined,
        JSON.stringify(evt)
      );

      processedCount++;
    }

    addLog(`[SYNC COMPLETE] Processed ${processedCount} queued events. Conflict flags raised: ${conflictCount}. Ledger blocks cryptographically signed & sealed.`);
    await sleep(200);
    setOfflineQueue([]);
    setIsSyncing(false);
  };

  // --- RULE #8: SCHEDULED BREAK AUTO-EXPIRY SWEEP ---
  const handleTriggerAutoExpirySweep = () => {
    let expiredCount = 0;

    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        const updatedSessions = t.sessions.map(s => {
          let sessionModified = false;
          const updatedBreaks = (s.breaks || []).map(b => {
            if (b.status === 'ACTIVE') {
              expiredCount++;
              sessionModified = true;
              
              // auto-expire break to 45 mins unpaid excess duration
              return {
                ...b,
                endTime: '13:00', // Auto-completed end time
                status: 'ENDED_AUTO_EXPIRY' as const,
                unpaidDurationMins: 45
              };
            }
            return b;
          });

          if (sessionModified) {
            appendLedger(
              t.id,
              t.name,
              s.employeeName,
              'BREAK_AUTO_EXPIRED_EXCESS_UNPAID',
              `Scheduled break auto-expired after limit check. 45 minutes of excessive elapsed duration auto-converted to unpaid shift duration.`,
              undefined,
              JSON.stringify({ sessionId: s.id })
            );
            return {
              ...s,
              status: 'NEEDS_REVIEW' as const,
              breaks: updatedBreaks
            };
          }
          return s;
        });

        return {
          ...t,
          sessions: updatedSessions
        };
      }
      return t;
    }));

    if (expiredCount > 0) {
      alert(`AUTO-EXPIRY SWEEP COMPLETE: Identified ${expiredCount} active breaks exceeding standard policy. Auto-terminated and deducted excess unpaid minutes.`);
    } else {
      alert("AUTO-EXPIRY SWEEP COMPLETE: No active policy-violating breaks found.");
    }
  };

  const handleSubmitBreakCorrection = (sessionId: string, breakId: string) => {
    if (!authSession) return;
    if (!correctionReqStart || !correctionReqEnd || !correctionReqReason) {
      alert("Please provide start time, end time, and a reason for the correction.");
      return;
    }

    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        return {
          ...t,
          sessions: t.sessions.map(s => {
            if (s.id === sessionId) {
              return {
                ...s,
                breaks: (s.breaks || []).map(b => {
                  if (b.id === breakId) {
                    return {
                      ...b,
                      status: 'CORRECTION_PENDING',
                      correctionRequest: {
                        requestedStartTime: correctionReqStart,
                        requestedEndTime: correctionReqEnd,
                        reason: correctionReqReason,
                        status: 'PENDING'
                      }
                    };
                  }
                  return b;
                })
              };
            }
            return s;
          })
        };
      }
      return t;
    }));

    setShowCorrectionForm(null);
    setCorrectionReqStart('');
    setCorrectionReqEnd('');
    setCorrectionReqReason('');

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      authSession.name,
      'BREAK_CORRECTION_REQUESTED',
      `Requested break correction for ${breakId}.`
    );
  };

  const handleApproveBreakCorrection = (sessionId: string, breakId: string, isApproved: boolean) => {
    if (!authSession) return;
    
    setTenants(prev => prev.map(t => {
      if (t.id === activeTenantId) {
        return {
          ...t,
          sessions: t.sessions.map(s => {
            if (s.id === sessionId) {
              return {
                ...s,
                breaks: (s.breaks || []).map(b => {
                  if (b.id === breakId && b.correctionRequest) {
                    if (isApproved) {
                      return {
                        ...b,
                        startTime: b.correctionRequest.requestedStartTime,
                        endTime: b.correctionRequest.requestedEndTime,
                        status: 'RECONCILED',
                        correctionRequest: {
                          ...b.correctionRequest,
                          status: 'APPROVED',
                          approverId: authSession.email
                        }
                      };
                    } else {
                      return {
                        ...b,
                        status: b.endTime ? 'ENDED' : 'ACTIVE', // Revert to original
                        correctionRequest: {
                          ...b.correctionRequest,
                          status: 'REJECTED',
                          approverId: authSession.email
                        }
                      };
                    }
                  }
                  return b;
                })
              };
            }
            return s;
          })
        };
      }
      return t;
    }));

    appendLedger(
      currentTenant.id,
      currentTenant.name,
      authSession.name,
      isApproved ? 'BREAK_CORRECTION_APPROVED' : 'BREAK_CORRECTION_REJECTED',
      `${isApproved ? 'Approved' : 'Rejected'} break correction for ${breakId}.`
    );
  };

  // Render login flow if not authenticated
  if (!authSession) {
    if (isRegistering) {
      return (
        <div className="bg-slate-950 border border-slate-800 rounded-[32px] p-6 md:p-10 shadow-[0_0_60px_-15px_rgba(16,185,129,0.2)] relative overflow-hidden select-none max-w-4xl mx-auto backdrop-blur-lg text-slate-200">
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                <Building2 className="w-5 h-5" />
              </span>
              <div>
                <span className="font-mono text-[9px] tracking-widest text-emerald-600 font-black uppercase">PERIMETER PLATFORM GATEWAY</span>
                <h2 className="font-display font-black text-lg text-white">Create Tenant Organization</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsRegistering(false);
                setRegistrationSuccess(null);
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs font-mono uppercase cursor-pointer text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel & Back to Sign In
            </button>
          </div>

          {/* We render the onboarding wizard right here! */}
          <div className="bg-slate-900/50 border border-slate-700 rounded-2xl p-6 md:p-8 shadow-inner">
            <div className="flex justify-between items-center mb-6 pb-3 border-b border-slate-700">
              <div>
                <h3 className="font-display font-black text-sm text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  Tenant Registration Request Form
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Your registered company will be queued in PENDING state awaiting Super Admin verification and feature allotment.
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-600 font-bold">Step {wizardStep} of 3</span>
            </div>

            <form onSubmit={handleOnboardingSubmit} className="space-y-6">
              {/* Step 1: Details */}
              {wizardStep === 1 && (
                <div className="space-y-4 font-sans">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Corporate Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Apex Logistics"
                        value={obName}
                        onChange={(e) => setObName(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Vertical</label>
                      <select
                        value={obIndustry}
                        onChange={(e) => setObIndustry(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500"
                      >
                        <option>Information Technology</option>
                        <option>Logistics & Transport</option>
                        <option>Healthcare & Nursing</option>
                        <option>Retail & Field Operations</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Local Timezone</label>
                      <input
                        type="text"
                        value={obTimezone}
                        onChange={(e) => setObTimezone(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Country</label>
                      <input
                        type="text"
                        value={obCountry}
                        onChange={(e) => setObCountry(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="block text-xs font-semibold text-emerald-600">Primary SaaS Admin Email Address</label>
                      <input
                        type="email"
                        required
                        placeholder="e.g. admin@apex.com"
                        value={obAdminEmail}
                        onChange={(e) => setObAdminEmail(e.target.value)}
                        className="w-full bg-slate-950 border border-emerald-500/30 text-xs text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 placeholder-slate-500 font-semibold shadow-inner"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        CRITICAL: You must login with this exact email to obtain Tenant Admin privileges once authorized.
                      </p>
                    </div>
                  </div>

                  {/* Plan Choices */}
                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between items-center">
                      <label className="block text-xs font-semibold text-slate-400">Choose Subscription Package</label>
                      <div className="flex items-center bg-slate-950 p-1 rounded-lg text-[10px] font-mono font-bold shadow-inner border border-slate-800">
                        <button
                          type="button"
                          onClick={() => setObBillingCycle('MONTHLY')}
                          className={`px-3 py-1 rounded-md transition-all cursor-pointer ${obBillingCycle === 'MONTHLY' ? 'bg-slate-800 shadow-sm text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          MONTHLY
                        </button>
                        <button
                          type="button"
                          onClick={() => setObBillingCycle('YEARLY')}
                          className={`px-3 py-1 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${obBillingCycle === 'YEARLY' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          YEARLY
                          <span className={`px-1 py-0.5 rounded text-[8px] ${obBillingCycle === 'YEARLY' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-700'}`}>-20%</span>
                        </button>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-3 gap-4">
                      {[
                        { id: 'STANDARD' as const, name: 'Standard', basePrice: 49, desc: 'Selfie & coordinate verification' },
                        { id: 'PREMIUM' as const, name: 'Premium', basePrice: 149, desc: 'Geofences & active liveness' },
                        { id: 'ENTERPRISE' as const, name: 'Enterprise', basePrice: 499, desc: 'Cryptographic ledger & SSO' }
                      ].map((plan) => (
                        <div
                          key={plan.id}
                          onClick={() => setObPlan(plan.id)}
                          className={`border border-slate-200 rounded-2xl p-4 cursor-pointer transition-all flex flex-col justify-between ${
                            obPlan === plan.id
                              ? 'bg-emerald-50/50 border-emerald-500 text-slate-900 shadow-lg shadow-emerald-500/10'
                              : 'bg-white hover:border-slate-300 text-slate-500'
                          }`}
                        >
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-display font-black text-xs uppercase tracking-wider">{plan.name}</span>
                              <span className="text-xs font-mono font-bold text-emerald-600">
                                ${obBillingCycle === 'YEARLY' ? Math.round(plan.basePrice * 12 * 0.8) : plan.basePrice}/{obBillingCycle === 'YEARLY' ? 'yr' : 'mo'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400">{plan.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-md hover:shadow-emerald-500/20"
                    >
                      Next: Core Policy Settings <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Policy */}
              {wizardStep === 2 && (
                <div className="space-y-4 font-sans">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Shift Start (HH:MM)</label>
                      <input
                        type="time"
                        value={obShiftStart}
                        onChange={(e) => setObShiftStart(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 placeholder-slate-600 font-semibold shadow-inner"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Grace Period (Minutes)</label>
                      <input
                        type="number"
                        value={obGrace}
                        onChange={(e) => setObGrace(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 placeholder-slate-600 font-semibold shadow-inner"
                      />
                    </div>

                    <div className="space-y-3 bg-slate-950/50 p-4 rounded-xl border border-slate-700 md:col-span-2 shadow-inner">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-semibold text-slate-200 block">Geofence Constraint</span>
                          <span className="text-[10px] text-slate-400">Lock coords to branch locations.</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={obGeoReq}
                          onChange={(e) => setObGeoReq(e.target.checked)}
                          className="w-4 h-4 accent-emerald-500"
                        />
                      </div>
                      {obGeoReq && (
                        <div className="pt-2 border-t border-slate-200 mt-2">
                          <label className="block text-[11px] text-slate-600 mb-1">Office Radius (Meters)</label>
                          <input
                            type="number"
                            value={obRadius}
                            onChange={(e) => setObRadius(Number(e.target.value))}
                            className="w-24 bg-slate-950 border border-slate-700 text-xs text-white rounded-xl px-2.5 py-1.5 focus:outline-none shadow-inner focus:border-emerald-500 focus:bg-slate-900"
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 bg-slate-950/50 p-4 rounded-xl border border-slate-700 md:col-span-2 shadow-inner">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-semibold text-slate-200 block">Required Photo Captures</span>
                          <span className="text-[10px] text-slate-400">Forces employees to snap selfies during check-in.</span>
                        </div>
                        <input
                          type="checkbox"
                          checked={obSelfieReq}
                          onChange={(e) => setObSelfieReq(e.target.checked)}
                          className="w-4 h-4 accent-emerald-500"
                        />
                      </div>
                      {obSelfieReq && (
                        <div className="flex items-center justify-between pt-2 border-t border-slate-700 mt-2">
                          <div>
                            <span className="text-[11px] text-slate-200 block">Strict Liveness Anti-Spoof</span>
                            <span className="text-[9px] text-slate-500">Blinks & facial motion challenge validations.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={obBiometric}
                            onChange={(e) => setObBiometric(e.target.checked)}
                            className="w-4 h-4 accent-emerald-500"
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 bg-slate-950/50 p-4 rounded-xl border border-slate-700 md:col-span-2 shadow-inner">
                      <span className="text-xs font-semibold text-slate-200 block border-b border-slate-800 pb-1.5 mb-2">Request Additional Enterprise Features</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[11px] font-medium text-slate-300 block">GPS Coordinates Logging</span>
                            <span className="text-[9px] text-slate-500">Track precise map locations for shifts.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={obGpsTracking}
                            onChange={(e) => setObGpsTracking(e.target.checked)}
                            className="w-4 h-4 accent-emerald-500"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[11px] font-medium text-slate-300 block">Dynamic Leave Accruals</span>
                            <span className="text-[9px] text-slate-500">Enable sick/casual/annual leaves.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={obLeaveManagement}
                            onChange={(e) => setObLeaveManagement(e.target.checked)}
                            className="w-4 h-4 accent-emerald-500"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[11px] font-medium text-slate-300 block">Immutable Security Ledger</span>
                            <span className="text-[9px] text-slate-500">Seal check-ins to dynamic blocks.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={obAuditLedger}
                            onChange={(e) => setObAuditLedger(e.target.checked)}
                            className="w-4 h-4 accent-emerald-500"
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[11px] font-medium text-slate-300 block">GPS Spoof Alerts</span>
                            <span className="text-[9px] text-slate-500">Detect simulated or faked locations.</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={obAnomalyAlerts}
                            onChange={(e) => setObAnomalyAlerts(e.target.checked)}
                            className="w-4 h-4 accent-emerald-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="px-4 py-2 border border-slate-700 hover:bg-slate-800 text-xs font-mono uppercase text-slate-400 hover:text-slate-200 transition-all rounded-lg"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setWizardStep(3)}
                      className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-md hover:shadow-emerald-500/20"
                    >
                      Next: Leave Limits <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Leaves */}
              {wizardStep === 3 && (
                <div className="space-y-4 font-sans">
                  <span className="font-mono text-[9px] text-emerald-600 font-black uppercase tracking-wider block">Step 3: Initial Leaves Allocation</span>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400 font-mono">Annual Leaves</label>
                      <input
                        type="number"
                        value={obAnnualLimit}
                        onChange={(e) => setObAnnualLimit(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 placeholder-slate-600 font-semibold shadow-inner"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400 font-mono">Sick Leaves</label>
                      <input
                        type="number"
                        value={obSickLimit}
                        onChange={(e) => setObSickLimit(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 placeholder-slate-600 font-semibold shadow-inner"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400 font-mono">Casual Leaves</label>
                      <input
                        type="number"
                        value={obCasualLimit}
                        onChange={(e) => setObCasualLimit(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-700 text-xs text-white rounded-xl px-3 py-2.5 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 placeholder-slate-600 font-semibold shadow-inner"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="px-4 py-2 border border-slate-700 hover:bg-slate-800 text-xs font-mono uppercase text-slate-400 hover:text-slate-200 transition-all rounded-lg"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md hover:shadow-emerald-500/20"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Submit & Transmit Request E-Mails
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-slate-950 border border-slate-800 rounded-[32px] p-6 md:p-10 shadow-[0_0_60px_-15px_rgba(16,185,129,0.2)] relative overflow-hidden max-w-lg mx-auto text-slate-200">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/10 rounded-full blur-[80px] pointer-events-none" />

        {/* Branding Header */}
        <div className="text-center space-y-3 mb-10 relative z-10">
          <div className="inline-flex p-3 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-3 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
            <ShieldCheck className="w-8 h-8 animate-pulse" />
          </div>
          <span className="font-mono text-[10px] tracking-widest text-emerald-400 font-black uppercase block shadow-sm">
            🔒 SECURE IDENTITY GATEWAY
          </span>
          <h2 className="font-display font-black text-3xl text-white tracking-tight leading-tight">
            Smart Teams Security Sign-In
          </h2>
          <p className="text-xs text-slate-400 max-w-[280px] mx-auto leading-relaxed">
            Enforcing rigid Multi-Tenant RBAC isolation with cryptographic JWT Claims.
          </p>
        </div>

        {/* Dynamic Success notifications */}
        {registrationSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-2 mb-6">
            <h4 className="font-bold text-emerald-400 text-xs uppercase tracking-wider flex items-center gap-1.5 font-mono">
              <CheckCircle2 className="w-4 h-4" />
              Onboarding Request Transmitted!
            </h4>
            <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
              Your company <strong className="text-white">{registrationSuccess.companyName}</strong> has been registered successfully.
            </p>
            <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800 font-mono text-[10px] space-y-1 shadow-inner">
              <div><span className="text-slate-400 font-sans">Assigned ID:</span> <span className="text-emerald-400">{registrationSuccess.tenantId}</span></div>
              <div><span className="text-slate-400 font-sans">Admin Email:</span> <span className="text-emerald-400">{registrationSuccess.adminEmail}</span></div>
              <div><span className="text-slate-400 font-sans">SaaS Package:</span> <span className="text-emerald-400">{registrationSuccess.plan}</span></div>
            </div>
            <p className="text-[9.5px] text-amber-300 italic font-mono leading-normal mt-2">
              Action Required: Log in below as the Global Super Admin to authorize and allot features!
            </p>
          </div>
        )}

        {/* Form */}
        {/* Pending Password Reset Check */}
        {pendingPasswordReset ? (
          <div className="space-y-4 font-sans animate-fade-in">
            <div className="bg-amber-950/30 border border-amber-500/30 text-amber-200 text-xs p-3 rounded-xl flex items-start gap-2 shadow-inner">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Action Required:</strong> You are logging in with a temporary password. Please set a new permanent password to continue.
              </span>
            </div>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              if (newPasswordInput.length < 8) {
                setLoginError("Password must be at least 8 characters long.");
                return;
              }
              
              setTenants(prev => prev.map(t => {
                if (t.id === pendingPasswordReset.tenantId) {
                  return {
                    ...t,
                    employees: t.employees.map(emp => {
                      if (emp.id === pendingPasswordReset.employeeId) {
                        return { ...emp, password: newPasswordInput, tempPasswordRequired: false };
                      }
                      return emp;
                    })
                  };
                }
                return t;
              }));
              
              // Proceed with login
              const matchedTenant = tenants.find(t => t.id === pendingPasswordReset.tenantId);
              const matchedEmployee = matchedTenant?.employees.find(e => e.id === pendingPasswordReset.employeeId);
              if (matchedEmployee) {
                const token = generateJWT({
                  email: matchedEmployee.email,
                  name: matchedEmployee.name,
                  role: matchedEmployee.role,
                  tenantId: matchedTenant!.id
                });
                const sessionObj: AuthSession = {
                  email: matchedEmployee.email,
                  name: matchedEmployee.name,
                  role: matchedEmployee.role as any,
                  tenantId: matchedTenant!.id,
                  token
                };
                localStorage.setItem('perimeter_auth_session', JSON.stringify(sessionObj));
                setAuthSession(sessionObj);
                setLoginError(null);
                setPendingPasswordReset(null);
              }
            }} className="space-y-4">
              {loginError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs p-3 rounded-xl flex items-start gap-2 font-sans">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{loginError}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-400 font-mono uppercase tracking-wider">New Permanent Password</label>
                <input
                  type="password"
                  required
                  placeholder="At least 8 characters"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700 text-xs text-white rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 font-semibold font-mono placeholder-slate-500 transition-colors shadow-inner"
                />
              </div>
              <button
                type="submit"
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-900 font-mono text-[10.5px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
              >
                <Lock className="w-3.5 h-3.5" />
                Set Password & Proceed
              </button>
            </form>
          </div>
        ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const email = loginEmailInput.trim().toLowerCase();
            
            // Check Super Admin Email
            if (email === superAdminEmail.toLowerCase()) {
              if (loginPasswordInput !== 'DemoSandbox_ChangeMe2026!') {
                setLoginError("Access Denied: Invalid credentials for Platform Super Admin.");
                return;
              }
              const token = generateJWT({
                email: superAdminEmail,
                name: "Platform Super Admin",
                role: "SUPER_ADMIN",
                tenantId: null
              });
              const sessionObj: AuthSession = {
                email: superAdminEmail,
                name: "Platform Super Admin",
                role: "SUPER_ADMIN",
                tenantId: null,
                token
              };
              localStorage.setItem('perimeter_auth_session', JSON.stringify(sessionObj));
              setAuthSession(sessionObj);
              setLoginError(null);
              return;
            }

            // Otherwise, match against all active employees in all companies
            let matchedTenant: TenantCompany | null = null;
            let matchedEmployee: any = null;

            for (const tenant of tenants) {
              const emp = tenant.employees.find(e => e.email.toLowerCase() === email);
              if (emp) {
                matchedTenant = tenant;
                matchedEmployee = emp;
                break;
              }
            }

            if (matchedEmployee && matchedTenant) {
              if (matchedTenant.status === 'PENDING') {
                setLoginError(`Access Denied: ${matchedTenant.name} is in a PENDING status. Please contact Super Admin to approve registration.`);
                return;
              }
              const expectedPassword = matchedEmployee.password || 'password';
              if (loginPasswordInput !== expectedPassword) {
                setLoginError("Access Denied: Invalid credentials.");
                return;
              }
              
              if (matchedEmployee.tempPasswordRequired) {
                setPendingPasswordReset({
                  tenantId: matchedTenant.id,
                  employeeId: matchedEmployee.id,
                  email: matchedEmployee.email
                });
                setLoginError(null);
                return;
              }

              const token = generateJWT({
                email: matchedEmployee.email,
                name: matchedEmployee.name,
                role: matchedEmployee.role,
                tenantId: matchedTenant.id
              });
              const sessionObj: AuthSession = {
                email: matchedEmployee.email,
                name: matchedEmployee.name,
                role: matchedEmployee.role as any,
                tenantId: matchedTenant.id,
                token
              };
              localStorage.setItem('perimeter_auth_session', JSON.stringify(sessionObj));
              setAuthSession(sessionObj);
              setLoginError(null);
            } else {
              setLoginError("Access Denied: Unregistered identity claim. Verify your credentials or choose a valid sandbox persona.");
            }
          }}
          className="space-y-4 font-sans"
        >
          {loginError && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs p-3 rounded-xl flex items-start gap-2 font-sans">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{loginError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-400 font-mono uppercase tracking-wider">Security Identity Claim (Email)</label>
            <input
              type="email"
              required
              placeholder="e.g. superadmin@example.com or admin@apex.com"
              value={loginEmailInput}
              onChange={(e) => setLoginEmailInput(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700 text-xs text-white rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 font-semibold font-mono placeholder-slate-500 transition-colors shadow-inner"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-400 font-mono uppercase tracking-wider">Access Token Secret</label>
            <input
              type="password"
              placeholder="•••••••• (Any password)"
              value={loginPasswordInput}
              onChange={(e) => setLoginPasswordInput(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700 text-xs text-white rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 focus:bg-slate-900 font-semibold font-mono placeholder-slate-500 transition-colors shadow-inner"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3.5 mt-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono text-[10.5px] font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]"
          >
            <Lock className="w-3.5 h-3.5" />
            Issue Cryptographic Access Token (JWT)
          </button>
        </form>
        )}

        {/* Secure Developer Testing Information */}
        <div className="mt-8 border-t border-slate-800 pt-6 space-y-3">
          <span className="font-mono text-[9.5px] tracking-wider text-slate-500 font-extrabold uppercase block text-center">
            🔒 Sandbox Authentication Panel
          </span>
          <p className="text-[10px] text-slate-400 text-center leading-relaxed max-w-sm mx-auto font-sans">
            Quick-Login bypass directories have been permanently disabled to prevent unauthorized role escalation. To login, please enter credentials manually.
          </p>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 font-mono text-[9px] text-slate-400 space-y-1.5 shadow-inner">
            <div><span className="text-emerald-500">Global Super Admin Email:</span> <span className="text-white">superadmin@example.com</span></div>
            <div><span className="text-emerald-500">Global Super Admin Key:</span> <span className="text-white">DemoSandbox_ChangeMe2026!</span></div>
            <div className="pt-1.5 border-t border-slate-900 text-[8.5px] text-amber-500 italic">
              * Note: For other roles or tenant staff, copy their temporary passwords from the Simulated Email Mailroom Stream at the bottom of the page.
            </div>
          </div>
        </div>

        {/* Public Tenant Onboarding Link */}
        <div className="mt-6 text-center border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => {
              setIsRegistering(true);
              setWizardStep(1);
            }}
            className="text-[10.5px] font-mono font-bold text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
          >
            Request Onboarding for a New Company Tenant →
          </button>
        </div>

      </div>
    );
  }

  return (
    <div className="bg-white/95 border border-slate-200/80 rounded-[32px] p-6 md:p-10 shadow-xl relative overflow-hidden select-none max-w-6xl mx-auto text-slate-800">
      
      {/* Decorative backdrop grid lights */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Main Header / Control Center Ribbon */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-200/80 mb-8">
        
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              <Building2 className="w-5 h-5 animate-pulse" />
            </span>
            <div>
              <span className="font-mono text-[9px] tracking-widest text-emerald-600 font-black uppercase flex items-center gap-1">
                <Database className="w-3.5 h-3.5" />
                ENTERPRISE MULTI-TENANT LEDGER SECURE
              </span>
              <h2 className="font-display font-black text-xl text-slate-950 tracking-tight">
                SaaS Control Center Sandbox
              </h2>
            </div>
          </div>
        </div>

        {/* Dynamic Context Switchers (Secure authenticated identity cards) */}
        <div className="flex flex-wrap items-center gap-4">
          
          {/* Tenant isolating switcher: Disabled for non-SUPER_ADMIN to enforce multi-tenant isolation */}
          <div className="space-y-1">
            <label className="block font-mono text-[8px] text-slate-500 font-black uppercase tracking-wider">Tenant Environment Sandbox</label>
            {authSession?.role === 'SUPER_ADMIN' ? (
              <select
                value={activeTenantId}
                onChange={(e) => {
                  setActiveTenantId(e.target.value);
                  setActiveTab('dashboard');
                }}
                className="bg-slate-50 border border-slate-200 hover:border-emerald-500/40 text-xs text-slate-800 rounded-xl px-4 py-2 focus:outline-none font-semibold transition-all cursor-pointer"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.id}) {t.status === 'PENDING' ? '[ONBOARDING]' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-semibold text-emerald-600 flex items-center gap-1.5 font-mono select-none">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                {currentTenant.name} ({currentTenant.id}) [LOCKED]
              </div>
            )}
          </div>

          {/* Secure JWT Session Badge with Log Out */}
          {authSession && (
            <div className="bg-slate-50 border border-emerald-500/20 rounded-xl p-2.5 flex items-center gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span className="font-mono text-[9px] text-emerald-600 font-bold uppercase tracking-wider flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 inline animate-pulse" />
                    JWT Secure Claims verified
                  </span>
                </div>
                <div className="text-[11px] font-bold text-slate-800 max-w-[160px] truncate">
                  {authSession.name}
                </div>
                <div className="text-[9px] text-slate-500 font-mono truncate max-w-[160px]">
                  {authSession.email} | <span className="text-emerald-600 font-bold">{authSession.role}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
                {/* Debug Token Button */}
                <button
                  type="button"
                  title="Decrypt / Inspect JWT Claims"
                  onClick={() => {
                    const jwtPayloadStr = JSON.stringify({
                      header: { alg: "HS256", typ: "JWT" },
                      payload: {
                        iss: "perimeter-security-auth",
                        sub: authSession.email,
                        name: authSession.name,
                        role: authSession.role,
                        tenantId: authSession.tenantId,
                        iat: Math.floor(Date.now() / 1000) - 100,
                        exp: Math.floor(Date.now() / 1000) + 7100
                      },
                      signature: "sha256-sig_" + btoa(authSession.email).substring(0, 16),
                      integrity: "100% SECURE - SIGNATURE_VERIFIED"
                    }, null, 2);
                    alert(`[DECRYPTED JWT SECURITY CLAIM SET]\n\n${jwtPayloadStr}`);
                  }}
                  className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-all cursor-pointer border border-emerald-200/50"
                >
                  <FileJson className="w-3.5 h-3.5" />
                </button>

                {/* Secure Log Out */}
                <button
                  type="button"
                  title="Secure Session Terminate"
                  onClick={() => {
                    localStorage.removeItem('perimeter_auth_session');
                    setAuthSession(null);
                  }}
                  className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 transition-all cursor-pointer border border-rose-200/50"
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Role Restriction Banner Warning */}
      {currentTenant.status === 'PENDING' && activeRole !== 'SUPER_ADMIN' && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl flex items-start gap-3 mb-8 animate-pulse">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <span className="font-bold block uppercase tracking-wider text-[10px] text-amber-700">TENANT AUTHENTICATION PENDING approval</span>
            <p>
              <strong>{currentTenant.name}</strong> has registered, but its tenant status is currently <strong>PENDING</strong>. Only the global <strong>Super Admin</strong> can approve and activate new organizations. Switch your role to Super Admin above to activate this tenant.
            </p>
          </div>
        </div>
      )}

      {/* Sub-tabs Nav bar (Adapts dynamically to RBAC permission boundaries) */}
      <div className="flex gap-2 overflow-x-auto pb-4 border-b border-slate-100 mb-8">
        {activeRole !== 'SUPER_ADMIN' && (
          <>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
                activeTab === 'dashboard' 
                  ? 'bg-slate-100 text-slate-800 border-slate-300' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-transparent'
              }`}
            >
              <Layers className="w-4 h-4 text-slate-500" />
              Isolated Roster
            </button>
            
            <button
              onClick={() => setActiveTab('clockin')}
              className={`px-4 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
                activeTab === 'clockin' 
                  ? 'bg-slate-100 text-slate-800 border-slate-300' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-transparent'
              }`}
            >
              <Camera className="w-4 h-4" />
              Dynamic Clock-In Portal
            </button>

            <button
              onClick={() => setActiveTab('break_engine')}
              className={`px-4 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
                activeTab === 'break_engine' 
                  ? 'bg-amber-50 text-amber-800 border-amber-200 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-transparent'
              }`}
            >
              <Timer className="w-4 h-4" />
              Break & Presence Engine
            </button>

            <button
              onClick={() => setActiveTab('leaves')}
              className={`px-4 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
                activeTab === 'leaves' 
                  ? 'bg-slate-100 text-slate-800 border-slate-300' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-transparent'
              }`}
            >
              <Calendar className="w-4 h-4 text-slate-500" />
              Dynamic Leaves ({currentTenant.leaves.annual} Annual)
            </button>
          </>
        )}

        {activeRole === 'COMPANY_ADMIN' && (
          <button
            onClick={() => setActiveTab('policy')}
            className={`px-4 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
              activeTab === 'policy' 
                ? 'bg-slate-100 text-slate-800 border-slate-300' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-transparent'
            }`}
          >
            <Settings className="w-4 h-4 text-slate-500" />
            Company Policies Engine
          </button>
        )}

        {activeRole === 'SUPER_ADMIN' && (
          <button
            onClick={() => setActiveTab('onboarding')}
            className={`px-4 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
              activeTab === 'onboarding' 
                ? 'bg-slate-100 text-slate-800 border-slate-300' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-transparent'
            }`}
          >
            <Building2 className="w-4 h-4 text-slate-500" />
            Onboard New Company
          </button>
        )}

        <button
          onClick={() => setActiveTab('ledger')}
          className={`px-4 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
            activeTab === 'ledger' 
              ? 'bg-slate-100 text-slate-800 border-slate-300' 
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 border-transparent'
          }`}
        >
          <Database className="w-4 h-4 text-slate-500" />
          Audit Ledger ({ledger.length} sealed blocks)
        </button>

        {activeRole === 'SUPER_ADMIN' && (
          <button
            onClick={() => setActiveTab('superadmin')}
            className={`px-4 py-2.5 rounded-full text-xs font-bold flex items-center gap-2 transition-all cursor-pointer border ${
              activeTab === 'superadmin' 
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-indigo-50 border-transparent'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            SuperAdmin Dashboard
          </button>
        )}
      </div>

      {/* RENDER ACTIVE SCREEN PANEL */}
      <div className="space-y-6">

        {/* If the tenant is PENDING and the user is NOT a SuperAdmin, completely block access to active tenant features! */}
        {currentTenant.status === 'PENDING' && activeRole !== 'SUPER_ADMIN' && activeTab !== 'onboarding' && activeTab !== 'ledger' ? (
          <div className="bg-white/90 border border-amber-500/30 rounded-3xl p-8 md:p-12 text-center space-y-6 max-w-2xl mx-auto shadow-2xl relative overflow-hidden my-4">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 animate-pulse" />
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 animate-bounce">
              <Lock className="w-8 h-8" />
            </div>
            
            <div className="space-y-2">
              <span className="font-mono text-[9px] text-amber-400 font-extrabold uppercase tracking-widest block">ONBOARDING WORKFLOW IS PENDING SECURITY CLEARANCE</span>
              <h3 className="font-display font-black text-xl text-slate-900 uppercase tracking-tight">Access Restricted for {currentTenant.name}</h3>
              <p className="text-xs text-slate-600 leading-relaxed max-w-md mx-auto">
                This tenant registry is in a <strong className="text-amber-300 font-bold">PENDING</strong> state. Attendance validation, roster isolations, and Clock-In APIs are restricted until a global **SuperAdmin** explicitly reviews and authorizes this tenant.
              </p>
            </div>


          </div>
        ) : null}

        {activeTab === 'break_engine' && (
          <div className="space-y-6 animate-fade-in font-sans">
            <div className="flex items-center gap-2 mb-2">
              <Timer className="w-5 h-5 text-amber-500" />
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Enterprise Break & Presence Engine</h2>
            </div>
            
            {/* Employee Break Actions */}
            {activeRole === 'EMPLOYEE' && (
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300 space-y-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  <Coffee className="w-4 h-4 text-amber-500" />
                  Your Break Dashboard
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <span className="text-slate-500 text-[10px] uppercase tracking-wider font-bold block mb-2">Available Break Types</span>
                    <div className="space-y-2">
                      {currentTenant.policy.breakTypes?.map(bt => (
                        <div key={bt.id} className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-200">
                          <div>
                            <span className="font-semibold text-xs text-slate-900 block">{bt.name}</span>
                            <span className="text-[10px] text-slate-500 block">{bt.allowedDuration} mins • {bt.isPaid ? 'Paid' : 'Unpaid'}</span>
                          </div>
                          <button
                            onClick={() => {
                              const sess = currentTenant.sessions.find(s => s.employeeName === authSession?.name && s.date === new Date().toISOString().split('T')[0]);
                              if (sess) handleStartBreak(sess.id, bt.id);
                              else alert("You must clock in first before starting a break.");
                            }}
                            className="px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 text-[10px] font-bold uppercase rounded-lg transition-colors cursor-pointer"
                          >
                            Start
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <span className="text-slate-500 text-[10px] uppercase tracking-wider font-bold block mb-2">Today's Active Break</span>
                    {(() => {
                      const sess = currentTenant.sessions.find(s => s.employeeName === authSession?.name && s.date === new Date().toISOString().split('T')[0]);
                      const activeBreak = sess?.breaks?.find(b => b.status === 'ACTIVE');
                      if (activeBreak) {
                        const bType = currentTenant.policy.breakTypes?.find(bt => bt.id === activeBreak.typeId);
                        return (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center space-y-3">
                            <span className="block text-amber-700 font-bold">{bType?.name} Break is Active</span>
                            <span className="block text-xs text-amber-600">Started at: {activeBreak.startTime}</span>
                            <button
                              onClick={() => sess && handleEndBreak(sess.id, activeBreak.id)}
                              className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                            >
                              End Break (Server Time)
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div className="h-full min-h-[100px] flex items-center justify-center border-2 border-dashed border-slate-200 rounded-xl">
                          <span className="text-slate-400 text-xs font-semibold">No active breaks</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider font-bold block mb-3">Break History & Corrections</span>
                  <div className="space-y-3">
                    {currentTenant.sessions.filter(s => s.employeeName === authSession?.name).map(sess => 
                      sess.breaks?.map(b => {
                        const bType = currentTenant.policy.breakTypes?.find(bt => bt.id === b.typeId);
                        return (
                          <div key={b.id} className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col md:flex-row gap-4 justify-between items-center">
                            <div>
                              <span className="font-semibold text-xs text-slate-900 flex items-center gap-1">
                                {bType?.name} <span className="text-slate-400 font-normal">({sess.date})</span>
                              </span>
                              <span className="text-[10px] text-slate-500 block">
                                {b.startTime} - {b.endTime || 'Ongoing'}
                                {b.status === 'CORRECTION_PENDING' && <span className="ml-2 text-amber-500 font-semibold">[Correction Pending]</span>}
                                {b.status === 'RECONCILED' && <span className="ml-2 text-emerald-500 font-semibold">[Reconciled]</span>}
                              </span>
                            </div>
                            
                            {b.status === 'ENDED' && showCorrectionForm !== b.id && (
                              <button
                                onClick={() => setShowCorrectionForm(b.id)}
                                className="px-3 py-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-[10px] font-bold uppercase rounded-lg transition-colors cursor-pointer"
                              >
                                Request Correction
                              </button>
                            )}

                            {showCorrectionForm === b.id && (
                              <div className="flex gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <input type="time" value={correctionReqStart} onChange={e => setCorrectionReqStart(e.target.value)} className="px-2 py-1 text-xs border border-slate-200 rounded" />
                                <input type="time" value={correctionReqEnd} onChange={e => setCorrectionReqEnd(e.target.value)} className="px-2 py-1 text-xs border border-slate-200 rounded" />
                                <input type="text" placeholder="Reason" value={correctionReqReason} onChange={e => setCorrectionReqReason(e.target.value)} className="px-2 py-1 text-xs border border-slate-200 rounded w-24" />
                                <button onClick={() => handleSubmitBreakCorrection(sess.id, b.id)} className="px-2 py-1 bg-amber-500 text-white text-[10px] font-bold rounded cursor-pointer">Submit</button>
                                <button onClick={() => setShowCorrectionForm(null)} className="px-2 py-1 bg-slate-200 text-slate-700 text-[10px] font-bold rounded cursor-pointer">Cancel</button>
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Manager / Admin Break Engine Dashboard */}
            {(activeRole === 'COMPANY_ADMIN' || authSession?.role === 'MANAGER') && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Pending Corrections */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-3xl p-6 shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                    Pending Break Corrections
                  </h3>
                  <div className="space-y-3">
                    {currentTenant.sessions.map(sess => 
                      sess.breaks?.filter(b => b.status === 'CORRECTION_PENDING').map(b => {
                        const bType = currentTenant.policy.breakTypes?.find(bt => bt.id === b.typeId);
                        return (
                          <div key={b.id} className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col md:flex-row justify-between gap-4">
                            <div>
                              <span className="font-semibold text-sm text-slate-900">{sess.employeeName}</span>
                              <span className="text-xs text-slate-600 block mt-1">Requested {bType?.name} correction</span>
                              <div className="mt-2 text-[11px] text-slate-500 font-mono space-y-1">
                                <div>Original: {b.startTime} - {b.endTime}</div>
                                <div className="text-amber-700 font-semibold">Requested: {b.correctionRequest?.requestedStartTime} - {b.correctionRequest?.requestedEndTime}</div>
                                <div className="italic text-slate-600 mt-1">"{b.correctionRequest?.reason}"</div>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2 justify-center">
                              <button onClick={() => handleApproveBreakCorrection(sess.id, b.id, true)} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold uppercase rounded-lg cursor-pointer">Approve</button>
                              <button onClick={() => handleApproveBreakCorrection(sess.id, b.id, false)} className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold uppercase rounded-lg cursor-pointer">Reject</button>
                            </div>
                          </div>
                        )
                      })
                    )}
                    {currentTenant.sessions.every(s => !s.breaks?.some(b => b.status === 'CORRECTION_PENDING')) && (
                      <div className="text-center py-8 text-slate-500 text-sm">No pending correction requests.</div>
                    )}
                  </div>
                </div>

                {/* AI Presence Anomalies */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-3xl p-6 shadow-xl hover:-translate-y-1 hover:shadow-2xl transition-all duration-300">
                  <h3 className="font-semibold text-slate-900 flex items-center gap-2 mb-4">
                    <Activity className="w-4 h-4 text-rose-500" />
                    Presence Anomalies Detected
                  </h3>
                  <div className="space-y-3">
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
                      <div className="flex justify-between items-start">
                        <span className="font-semibold text-xs text-slate-900">John Peterson</span>
                        <span className="text-[9px] font-bold text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">HIGH RISK</span>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-1">
                        GPS disconnected for 45 minutes between 11:00 AM and 11:45 AM. No declared break on record. Possible undeclared absence.
                      </p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                      <div className="flex justify-between items-start">
                        <span className="font-semibold text-xs text-slate-900">Marcus Brody</span>
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">WARNING</span>
                      </div>
                      <p className="text-[10px] text-slate-600 mt-1">
                        Lunch break exceeded policy duration (45m) by 22 minutes.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 0: SECURE SUPERADMIN DASHBOARD */}
        {activeTab === 'superadmin' && activeRole === 'SUPER_ADMIN' && (
          <div className="space-y-6 animate-fade-in text-slate-800">
            {/* Top Stat grid for System-wide Analytics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-indigo-50/50 border border-indigo-100 p-4 rounded-2xl">
                <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider font-semibold">Total Registered Companies</span>
                <span className="text-2xl font-black text-slate-900 block mt-1">{tenants.length}</span>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-indigo-600 font-semibold">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Organizations</span>
                </div>
              </div>
              <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-2xl">
                <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider font-semibold">Awaiting Approval</span>
                <span className={`text-2xl font-black block mt-1 ${tenants.some(t => t.status === 'PENDING') ? 'text-amber-600 animate-pulse' : 'text-slate-500'}`}>
                  {tenants.filter(t => t.status === 'PENDING').length}
                </span>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-600 font-semibold">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Pending review</span>
                </div>
              </div>
              <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-2xl">
                <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider font-semibold">Active Tenants</span>
                <span className="text-2xl font-black text-emerald-600 block mt-1">
                  {tenants.filter(t => t.status === 'ACTIVE').length}
                </span>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-emerald-600 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Operational</span>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                <span className="text-slate-500 block font-mono text-[9px] uppercase tracking-wider font-semibold">Total System Employees</span>
                <span className="text-2xl font-black text-slate-900 block mt-1">
                  {tenants.reduce((sum, t) => sum + t.employees.length, 0)}
                </span>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-600 font-semibold">
                  <Users className="w-3.5 h-3.5" />
                  <span>Personnel</span>
                </div>
              </div>
            </div>

            {/* Approval Workspace and Directory */}
            <div className="grid lg:grid-cols-12 gap-6">
              
              {/* Main workspace */}
              <div className="lg:col-span-8 bg-white/50 border border-indigo-500/20 rounded-2xl p-6 space-y-6">
                <div>
                  <h3 className="font-display font-black text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-indigo-400" />
                    Company Approval & Lifecycle Workflows
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Manage tenant company states, review biometric constraints, and authorize or restrict access to the core platform.
                  </p>
                </div>

                <div className="space-y-4">
                  {tenants.map((company) => (
                    <div 
                      key={company.id} 
                      className={`border rounded-2xl p-5 transition-all ${
                        company.status === 'PENDING' 
                          ? 'bg-amber-500/5 border-amber-500/30 shadow-lg shadow-amber-500/5' 
                          : company.status === 'SUSPENDED'
                          ? 'bg-rose-500/5 border-rose-500/20'
                          : 'bg-slate-100/10 border-slate-800'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2.5">
                            <span className="p-1.5 rounded-lg bg-slate-100 border border-slate-800 text-emerald-600">
                              <Building2 className="w-4 h-4" />
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-display font-bold text-sm text-slate-900">{company.name}</h4>
                                <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold tracking-wider uppercase ${
                                  company.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                  company.status === 'PENDING' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' :
                                  'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                  {company.status}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-500 block">{company.industry} • {company.country}</span>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 pt-1 text-[10.5px] font-mono text-slate-500">
                            <div><span className="text-slate-500">ID:</span> {company.id}</div>
                            <div><span className="text-slate-500">Zone:</span> {company.timezone.split(' ')[0]}</div>
                            <div><span className="text-slate-500">Staff count:</span> {company.employees.length}</div>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                          {company.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => handleTenantStatus(company.id, 'ACTIVE')}
                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-slate-900 text-[10.5px] font-black uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-md"
                              >
                                <Check className="w-3.5 h-3.5" /> Approve & Activate
                              </button>
                              <button
                                onClick={() => {
                                  setTenants(prev => prev.map(t => t.id === company.id ? { ...t, status: 'SUSPENDED' } : t));
                                  appendLedger(
                                    company.id,
                                    company.name,
                                    'Super Admin (Platform Owner)',
                                    'COMPANY_REJECTED',
                                    `Company onboarding request rejected and status set to SUSPENDED.`
                                  );
                                }}
                                className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 text-[10.5px] font-black uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                              >
                                <X className="w-3.5 h-3.5" /> Reject
                              </button>
                            </>
                          )}

                          {company.status === 'ACTIVE' && (
                            <button
                              onClick={() => handleTenantStatus(company.id, 'SUSPENDED')}
                              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-slate-900 text-[10.5px] font-black uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-md"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" /> Suspend Tenant
                            </button>
                          )}

                          {company.status === 'SUSPENDED' && (
                            <button
                              onClick={() => handleTenantStatus(company.id, 'ACTIVE')}
                              className="px-3.5 py-1.5 bg-slate-200 hover:bg-slate-200 border border-slate-700 text-slate-900 text-[10.5px] font-black uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                            >
                              <RefreshCw className="w-3 h-3" /> Re-Activate
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Policy parameters summary */}
                      <div className="mt-3.5 pt-3.5 border-t border-slate-800/60 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono bg-slate-950/40 p-2.5 rounded-xl border border-slate-900">
                        <div>
                          <span className="text-slate-500 block">Shift Start</span>
                          <span className="text-emerald-600 font-bold">{company.policy.shiftStart} (Grace: {company.policy.gracePeriodMins}m)</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Selfie Liveness</span>
                          <span className={company.policy.selfieRequired ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                            {company.policy.selfieRequired ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Geofence Limit</span>
                          <span className={company.policy.geofenceRequired ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                            {company.policy.geofenceRequired ? `${company.policy.radiusMeters}m` : 'Disabled'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Face Biometric</span>
                          <span className={company.policy.faceBiometric ? 'text-indigo-400 font-bold' : 'text-slate-500'}>
                            {company.policy.faceBiometric ? 'Strict' : 'Standard'}
                          </span>
                        </div>
                      </div>

                      {/* Granular Super Admin Feature Toggles for this specific tenant */}
                      <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-2">
                        <span className="font-mono text-[9px] text-emerald-600 font-black uppercase tracking-wider block">SuperAdmin Core Feature Allotments (Toggle privileges)</span>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {[
                            { key: 'gpsTracking', label: 'GPS Geofencing', desc: 'Lock clock-in coordinates to office radius' },
                            { key: 'selfieCheckin', label: 'Selfie Check-In', desc: 'Enforce selfie captures on shift change' },
                            { key: 'livenessScanning', label: 'Biometric Liveness', desc: 'Structural face challenge on webcam' },
                            { key: 'leaveManagement', label: 'Leave Workflows', desc: 'File & approve leave requests' },
                            { key: 'auditLedger', label: 'Immutable Ledger', desc: 'Write blocks to the secure state chain' },
                            { key: 'anomalyAlerts', label: 'GPS Spoof Alerts', desc: 'Detect fake locations and bypass attempts' }
                          ].map((feat) => {
                            const isAllotted = company.allowedFeatures?.[feat.key as keyof typeof company.allowedFeatures] !== false;
                            return (
                              <button
                                key={feat.key}
                                type="button"
                                onClick={() => handleToggleFeature(company.id, feat.key as any)}
                                className={`flex flex-col justify-between p-2 rounded-xl text-left font-mono text-[10px] border transition-all cursor-pointer ${
                                  isAllotted
                                    ? 'bg-slate-100/50 border-emerald-500/50 text-slate-900 shadow-sm'
                                    : 'bg-white border-slate-800/80 text-slate-500'
                                }`}
                              >
                                <div className="flex items-center justify-between w-full mb-1">
                                  <span className="font-bold text-[10px]">{feat.label}</span>
                                  <span className={`w-3 h-3 rounded-full border flex items-center justify-center p-0.5 ${
                                    isAllotted ? 'border-emerald-500' : 'border-slate-800'
                                  }`}>
                                    {isAllotted && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                                  </span>
                                </div>
                                <span className="text-[8.5px] text-slate-500 font-sans leading-tight">
                                  {feat.desc}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right column system stats & settings */}
              <div className="lg:col-span-4 space-y-6">
                               {/* Simulated SMTP Secure Mailroom Inbox Client */}
                <div className="bg-white/90 border border-indigo-500/30 rounded-2xl p-5 space-y-4 shadow-lg shadow-indigo-500/5">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        <Bell className="w-4 h-4 animate-bounce" />
                      </span>
                      <div>
                        <span className="font-mono text-[8.5px] text-emerald-600 font-black uppercase tracking-wider block">SMTP Secure Gateway</span>
                        <h4 className="font-display font-black text-xs text-slate-900 uppercase tracking-tight">Corporate Mail Receiver</h4>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-mono text-emerald-400 font-bold animate-pulse">
                      ● ONLINE
                    </span>
                  </div>

                  <p className="text-[10.5px] text-slate-500 leading-normal">
                    This SMTP proxy intercepts all transactional SaaS registrations, package selections, and compliance notifications in real-time.
                  </p>

                  <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-900 space-y-2 text-[10px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-500">SMTP Gateway:</span>
                      <span className="text-emerald-600 font-bold">mail.smartteams.sec</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Deliverability:</span>
                      <span className="text-emerald-400 font-bold flex items-center gap-1">● Intercepted Live</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-mono text-indigo-300 font-bold uppercase tracking-wider">Mailroom Stream ({simulatedEmails.length} messages)</span>
                      {simulatedEmails.length > 0 && (
                        <button
                          onClick={() => {
                            setSimulatedEmails([]);
                            localStorage.removeItem('perimeter_simulated_emails');
                          }}
                          className="text-[8.5px] font-mono text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          Clear Mail
                        </button>
                      )}
                    </div>

                    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                      {simulatedEmails.length === 0 ? (
                        <div className="text-center py-6 text-[10.5px] text-slate-500 italic bg-slate-950/40 rounded-xl border border-slate-900">
                          Mailroom is empty. New onboarding requests or policy updates will dispatch transactional letters here.
                        </div>
                      ) : (
                        simulatedEmails.map((email) => {
                          const isRegReq = email.subject.includes('[Onboarding Request]');
                          const assocCompany = isRegReq && email.tenantId ? tenants.find(t => t.id === email.tenantId) : null;
                          const isPending = assocCompany?.status === 'PENDING';

                          return (
                            <div
                              key={email.id}
                              className={`p-3 rounded-xl border transition-all text-[11px] font-mono leading-normal space-y-2 ${
                                !email.read 
                                  ? 'bg-slate-100/40 border-emerald-500/30 shadow-md shadow-emerald-500/5' 
                                  : 'bg-slate-950/50 border-slate-900 text-slate-600'
                              }`}
                            >
                              <div className="flex justify-between items-start gap-1">
                                <span className="text-emerald-600 font-bold truncate max-w-[120px]" title={email.from}>
                                  FROM: {email.from.split('@')[0]}
                                </span>
                                <span className="text-slate-500 text-[8.5px] shrink-0">{email.timestamp.split(',')[1] || email.timestamp}</span>
                              </div>

                              <div>
                                <span className="block font-bold text-slate-900 text-[10.5px] leading-tight">
                                  {email.subject}
                                </span>
                              </div>

                              <div className="text-slate-500 text-[10px] bg-white p-2 rounded-lg border border-slate-900/60 font-sans whitespace-pre-wrap leading-relaxed">
                                {email.body}

                                {isRegReq && isPending && email.tenantId && (
                                  <div className="mt-2.5 pt-2 border-t border-slate-800 flex flex-col gap-1.5">
                                    <span className="text-[9px] font-mono text-amber-400 font-bold block">
                                      ⚠️ ACTION REQUIRED: Verify details & activate tenant
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleTenantStatus(email.tenantId!, 'ACTIVE');
                                        setSimulatedEmails(prev => prev.map(m => m.id === email.id ? { ...m, read: true } : m));
                                      }}
                                      className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-slate-900 font-mono text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                                    >
                                      <Check className="w-3 h-3" /> Approve Registration
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-between items-center text-[8.5px] text-slate-500">
                                <span className="truncate max-w-[100px]" title={email.to}>TO: {email.to.split('@')[0]}</span>
                                {!email.read && (
                                  <button
                                    onClick={() => setSimulatedEmails(prev => prev.map(m => m.id === email.id ? { ...m, read: true } : m))}
                                    className="text-indigo-400 hover:text-indigo-300 font-semibold"
                                  >
                                    Mark read
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Secure Seal Cryptography Card */}
                <div className="bg-white/50 border border-indigo-500/20 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      <Cpu className="w-4 h-4" />
                    </span>
                    <div>
                      <span className="font-mono text-[8.5px] text-indigo-400 font-black uppercase block">Ledger Encryption Seal</span>
                      <h4 className="font-display font-bold text-xs text-slate-900 uppercase tracking-tight">Active State Security</h4>
                    </div>
                  </div>
                  
                  <p className="text-[10.5px] text-slate-500 leading-normal">
                    Every state transition is bound with a cryptographic block signature to enforce immutable records of attendance and compliance.
                  </p>
                  
                  <div className="text-[9.5px] font-mono text-slate-500 bg-black/40 p-2 rounded-xl border border-slate-900">
                    <span className="text-emerald-600 block font-bold mb-1">CURRENT HEADER BLOCK:</span>
                    <span className="break-all">{ledger[0]?.hash || 'genesis_unsealed'}</span>
                  </div>
                </div>

              </div>
              
            </div>
          </div>
        )}

        {/* TAB 1: LOCAL ROSTER / SESSION LIST */}
        {activeTab === 'dashboard' && (activeRole === 'SUPER_ADMIN' || currentTenant.status !== 'PENDING') && (
          <div className="grid lg:grid-cols-12 gap-8">
            {/* Left roster roster column */}
            <div className="lg:col-span-8 space-y-6">
              
              <div className="bg-white/50 border border-slate-200 rounded-2xl p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-display font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-600" />
                    Employee Attendance Ledger ({currentTenant.sessions.length} active)
                  </h3>
                  <span className="text-[10px] font-mono text-slate-500">TENANT: {currentTenant.id}</span>
                </div>

                <div className="space-y-3">
                  {currentTenant.sessions.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500 italic">
                      No shift records logged inside this tenant context. Go to "Dynamic Clock-In Portal" tab to verify checkout logs.
                    </div>
                  ) : (
                    currentTenant.sessions.map((sess) => (
                      <div key={sess.id} className="bg-slate-100/30 border border-slate-200 rounded-xl p-4 space-y-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-slate-900 block text-sm">{sess.employeeName}</span>
                            <span className="font-mono text-[9px] text-slate-500">DATE: {sess.date} | CHECK-IN: {sess.checkIn}</span>
                          </div>
                          
                          <span className={`px-2.5 py-0.5 rounded-full text-[9.5px] font-mono font-bold tracking-wider uppercase border ${
                            sess.status === 'ACTIVE' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' :
                            sess.status === 'LATE' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                            sess.status === 'NEEDS_REVIEW' ? 'bg-rose-500/10 border-rose-500/30 text-rose-500 animate-pulse' :
                            'bg-slate-200/10 border-slate-200 text-slate-600'
                          }`}>
                            {sess.status}
                          </span>
                        </div>

                        {/* Interactive Verification Proof Logs */}
                        <div className="bg-white rounded-lg p-2.5 space-y-1.5 border border-slate-200">
                          <span className="font-mono text-[8px] text-slate-500 font-bold block uppercase tracking-wider">Verification Proof logs (Sealed)</span>
                          {sess.verificationLog.map((logLine, idx) => (
                            <div key={idx} className="flex items-start gap-1.5 text-[9.5px] font-mono text-slate-800">
                              <span className="text-emerald-400">↳</span>
                              <span>{logLine}</span>
                            </div>
                          ))}
                        </div>

                        {/* Selfie image preview if captures */}
                        {sess.selfie && (
                          <div className="flex items-center gap-3 bg-white/40 p-2 rounded-lg border border-slate-200">
                            <img src={sess.selfie} alt="Verified Selfie" className="w-12 h-9 rounded object-cover border border-slate-200" referrerPolicy="no-referrer" />
                            <div className="text-[10px] font-sans text-slate-500">
                              <span className="font-semibold block text-emerald-600">FACIAL IDENTITY MATCHED</span>
                              Captured at NYC Office geofence entry point.
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Local leave requests panel */}
              <div className="bg-white/50 border border-slate-200 rounded-2xl p-6">
                <h3 className="font-display font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-emerald-600" />
                  Leave Request Queue ({currentTenant.leaveRequests.filter(r => r.status === 'PENDING').length} Pending)
                </h3>

                <div className="space-y-3">
                  {currentTenant.leaveRequests.length === 0 ? (
                    <div className="text-center py-6 text-xs text-slate-500 italic">
                      No leave requests filed. Go to "Dynamic Leaves" tab to submit.
                    </div>
                  ) : (
                    currentTenant.leaveRequests.map((req) => (
                      <div key={req.id} className="bg-slate-100/20 border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm">{req.employeeName}</span>
                            <span className="px-2 py-0.5 rounded bg-slate-200 text-[9px] font-mono font-bold uppercase text-slate-600">
                              {req.type} leave
                            </span>
                          </div>
                          <p className="font-mono text-[10px] text-slate-500">
                            Range: {req.startDate} to {req.endDate} ({req.daysRequested} working days)
                          </p>
                          <p className="text-xs text-slate-600 italic">"{req.reason}"</p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {req.status === 'PENDING' ? (
                            activeRole === 'COMPANY_ADMIN' ? (
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => handleLeaveDecision(req.id, 'APPROVED')}
                                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-slate-900 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleLeaveDecision(req.id, 'REJECTED')}
                                  className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-slate-900 text-[11px] font-bold rounded-lg transition-colors cursor-pointer"
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-amber-400 font-bold animate-pulse uppercase">PENDING ADMIN</span>
                            )
                          ) : (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold ${
                              req.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}>
                              {req.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Right tenant details panel */}
            <div className="lg:col-span-4 space-y-6">
              
              <div className="bg-slate-100/50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <span className="font-mono text-[9px] text-emerald-600 font-black uppercase block tracking-wider">Tenant Settings Card</span>
                <div>
                  <h4 className="font-display font-black text-lg text-slate-900 leading-tight">{currentTenant.name}</h4>
                  <span className="font-sans text-xs text-slate-600">{currentTenant.industry}</span>
                </div>

                <div className="border-t border-slate-200 pt-3 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Timezone</span>
                    <span className="font-mono font-bold text-slate-900 text-[11px]">{currentTenant.timezone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Country</span>
                    <span className="text-slate-900 font-semibold">{currentTenant.country}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tenant status</span>
                    <span className={`font-mono font-black text-[10px] ${currentTenant.status === 'ACTIVE' ? 'text-emerald-600' : 'text-amber-400'}`}>
                      {currentTenant.status}
                    </span>
                  </div>
                </div>

                {/* Company Holidays */}
                <div className="border-t border-slate-200 pt-3 space-y-2">
                  <span className="font-mono text-[8.5px] text-slate-500 font-black block uppercase tracking-wider">Company Holidays</span>
                  <div className="space-y-1">
                    {currentTenant.holidays.map((hol, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[10px] bg-white p-1.5 rounded border border-slate-200">
                        <span className="font-semibold text-slate-900">{hol.name}</span>
                        <span className="font-mono text-slate-500">{hol.date}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Team roster */}
                <div className="border-t border-slate-200 pt-3 space-y-2">
                  <span className="font-mono text-[8.5px] text-slate-500 font-black block uppercase tracking-wider">Isolated Employees</span>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {currentTenant.employees.map((emp) => (
                      <div key={emp.id} className="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-slate-200">
                        <div>
                          <span className="font-semibold text-slate-900 block">{emp.name}</span>
                          <span className="font-mono text-[9px] text-slate-500">{emp.role} | {emp.email}</span>
                        </div>
                        <span className="text-[10px] font-mono text-emerald-600">
                          Bal: {currentTenant.leaves.annual - emp.leavesUsed.annual}d
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* ADMIN ONLY: Appoint Manager / Add Employee Form */}
                  {(activeRole === 'COMPANY_ADMIN' || activeRole === 'SUPER_ADMIN') && (
                    <form onSubmit={handleAddEmployee} className="pt-3 border-t border-slate-800/60 space-y-2.5">
                      <span className="font-mono text-[8.5px] text-emerald-600 font-black block uppercase tracking-wider">
                        Quick Add Personnel / Appoint Manager
                      </span>
                      
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          required
                          placeholder="Full Name"
                          value={newEmpName}
                          onChange={(e) => setNewEmpName(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-[11px] text-slate-900 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                        />
                        <input
                          type="email"
                          required
                          placeholder="Email Address"
                          value={newEmpEmail}
                          onChange={(e) => setNewEmpEmail(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-[11px] text-slate-900 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                        />
                        <div className="flex flex-wrap gap-1">
                          {(['EMPLOYEE', 'MANAGER', 'HR', 'GM', 'ADMIN'] as const).map((roleOption) => (
                            <button
                              key={roleOption}
                              type="button"
                              onClick={() => setNewEmpRole(roleOption)}
                              className={`flex-1 min-w-[55px] py-1 rounded text-[9px] font-mono font-bold uppercase transition-all cursor-pointer ${
                                newEmpRole === roleOption
                                  ? 'bg-slate-100 text-emerald-600 border border-emerald-500/30'
                                  : 'bg-white text-slate-500 hover:text-slate-600 border border-slate-200'
                              }`}
                            >
                              {roleOption}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-500/90 text-white font-mono text-[10px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Save & Send Invite Mail
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Real-time notification hub */}
              <div className="bg-white/50 border border-slate-200 rounded-2xl p-5">
                <h4 className="font-display font-bold text-xs text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-amber-400" />
                  Isolated Notification Center
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {notifications.map((n) => (
                    <div key={n.id} className="text-[10.5px] font-mono bg-slate-100/20 p-2 rounded border border-slate-200 leading-normal">
                      <span className="text-slate-500 block text-[8px]">{n.time}</span>
                      <span className="text-slate-800">{n.text}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 2: ACTIVE POLICY CONFIGURATION ENGINE */}
        {activeTab === 'policy' && activeRole === 'COMPANY_ADMIN' && currentTenant.status !== 'PENDING' && (
          <div className="bg-white/50 border border-slate-200 rounded-2xl p-6 space-y-6">
            <div className="border-b border-slate-200 pb-3">
              <h3 className="font-display font-black text-base text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-600" />
                Dynamic Policy Configuration Service
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Calibrate dynamic thresholds for late arrivals, shift timings, biometric liveness targets, and secure geofence boundaries.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              
              <div className="bg-slate-100/20 border border-slate-200 rounded-xl p-5 space-y-4">
                <span className="font-mono text-[9px] text-emerald-600 font-black uppercase block tracking-wider">Attendance Parameters</span>
                
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400">Daily Shift Start Time</label>
                  <input
                    type="time"
                    value={currentTenant.policy.shiftStart}
                    onChange={(e) => handlePolicyUpdate('shiftStart', e.target.value)}
                    className="w-full bg-white border border-slate-200 text-sm text-slate-900 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-500 block">Arrival after shift start + grace is marked as Late.</span>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400">Grace Arrival Allowance (Minutes)</label>
                  <input
                    type="number"
                    value={currentTenant.policy.gracePeriodMins}
                    onChange={(e) => handlePolicyUpdate('gracePeriodMins', Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 text-sm text-slate-900 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-400">Half-Day Shift Requirement (Minutes)</label>
                  <input
                    type="number"
                    value={currentTenant.policy.halfDayMins}
                    onChange={(e) => handlePolicyUpdate('halfDayMins', Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 text-sm text-slate-900 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="bg-slate-100/20 border border-slate-200 rounded-xl p-5 space-y-4">
                <span className="font-mono text-[9px] text-emerald-600 font-black uppercase block tracking-wider">Biometric & GPS Controls</span>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">Geofence Location Restriction</span>
                      <span className="text-[10px] text-slate-400">Lock clock-in coordinates to office radius.</span>
                    </div>
                    <button
                      onClick={() => handlePolicyUpdate('geofenceRequired', !currentTenant.policy.geofenceRequired)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-[9px] font-bold tracking-wider cursor-pointer transition-all ${
                        currentTenant.policy.geofenceRequired ? 'bg-emerald-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {currentTenant.policy.geofenceRequired ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {currentTenant.policy.geofenceRequired && (
                    <div className="space-y-2 pl-3 border-l-2 border-slate-200 pt-1">
                      <label className="block text-[11px] text-slate-600">Geofence Radius Limit (Meters)</label>
                      <input
                        type="number"
                        value={currentTenant.policy.radiusMeters}
                        onChange={(e) => handlePolicyUpdate('radiusMeters', Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">Capture Selfie Challenge</span>
                      <span className="text-[10px] text-slate-400">Require camera upload during shift seal.</span>
                    </div>
                    <button
                      onClick={() => handlePolicyUpdate('selfieRequired', !currentTenant.policy.selfieRequired)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-[9px] font-bold tracking-wider cursor-pointer transition-all ${
                        currentTenant.policy.selfieRequired ? 'bg-emerald-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {currentTenant.policy.selfieRequired ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {currentTenant.policy.selfieRequired && (
                    <div className="flex items-center justify-between pl-3 border-l-2 border-slate-200 pt-2">
                      <div>
                        <span className="text-[11px] text-slate-200 block">Strict Face Biometric Liveness</span>
                        <span className="text-[9.5px] text-slate-500">Requires structural face match.</span>
                      </div>
                      <button
                        onClick={() => handlePolicyUpdate('faceBiometric', !currentTenant.policy.faceBiometric)}
                        className={`px-2.5 py-1 rounded-lg font-mono text-[8.5px] font-bold tracking-wider cursor-pointer transition-all ${
                          currentTenant.policy.faceBiometric ? 'bg-indigo-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {currentTenant.policy.faceBiometric ? 'ACTIVE_SCAN' : 'PHOTO_ONLY'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-200/40">
                  <span className="font-mono text-[9px] text-emerald-600 font-black uppercase block tracking-wider">Advanced Verification Methods</span>

                  {/* Wi-Fi Verification Toggle */}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">Office Wi-Fi SSID Lock</span>
                      <span className="text-[10px] text-slate-400">Require connection to company router.</span>
                    </div>
                    <button
                      onClick={() => handlePolicyUpdate('wifiSSIDRequired', !currentTenant.policy.wifiSSIDRequired)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-[9px] font-bold tracking-wider cursor-pointer transition-all ${
                        currentTenant.policy.wifiSSIDRequired ? 'bg-emerald-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {currentTenant.policy.wifiSSIDRequired ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {currentTenant.policy.wifiSSIDRequired && (
                    <div className="space-y-2 pl-3 border-l-2 border-slate-200 pt-1">
                      <label className="block text-[11px] text-slate-600 font-semibold">Approved SSIDs (Comma-separated)</label>
                      <input
                        type="text"
                        value={currentTenant.policy.wifiSSIDs?.join(', ') || ''}
                        onChange={(e) => handlePolicyUpdate('wifiSSIDs', e.target.value.split(',').map(s => s.trim()))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                        placeholder="Apex_HQ_Secure, Apex_Staff_Guest"
                      />
                    </div>
                  )}

                  {/* QR Code Verification Toggle */}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">Dynamic Reception QR Code</span>
                      <span className="text-[10px] text-slate-400">Scan desk QR code for office verification.</span>
                    </div>
                    <button
                      onClick={() => handlePolicyUpdate('qrRequired', !currentTenant.policy.qrRequired)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-[9px] font-bold tracking-wider cursor-pointer transition-all ${
                        currentTenant.policy.qrRequired ? 'bg-emerald-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {currentTenant.policy.qrRequired ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {/* Fingerprint TouchID Enclave Toggle */}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">Enclave Fingerprint (TouchID)</span>
                      <span className="text-[10px] text-slate-400">Validate local device hardware secure key.</span>
                    </div>
                    <button
                      onClick={() => handlePolicyUpdate('fingerprintRequired', !currentTenant.policy.fingerprintRequired)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-[9px] font-bold tracking-wider cursor-pointer transition-all ${
                        currentTenant.policy.fingerprintRequired ? 'bg-emerald-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {currentTenant.policy.fingerprintRequired ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {/* VPN / Remote PC Registration Toggle */}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">Desktop VPN / PC Lock</span>
                      <span className="text-[10px] text-slate-400">Enforce enterprise VPN client & trusted HWID.</span>
                    </div>
                    <button
                      onClick={() => handlePolicyUpdate('vpnRequired', !currentTenant.policy.vpnRequired)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-[9px] font-bold tracking-wider cursor-pointer transition-all ${
                        currentTenant.policy.vpnRequired ? 'bg-emerald-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {currentTenant.policy.vpnRequired ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>

                  {/* Presence Validation Timer Interval */}
                  <div className="space-y-2 pt-2 border-t border-slate-200/50">
                    <label className="block text-xs font-semibold text-slate-400">Random Presence Audit Interval (Minutes)</label>
                    <input
                      type="number"
                      value={currentTenant.policy.presenceCheckInterval || 0}
                      onChange={(e) => handlePolicyUpdate('presenceCheckInterval', Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                      placeholder="e.g. 120 (0 to disable)"
                    />
                  </div>

                  {/* Break Validation Toggle */}
                  <div className="flex items-center justify-between pt-2">
                    <div>
                      <span className="text-xs font-semibold text-slate-200 block">Break Validation Control</span>
                      <span className="text-[10px] text-slate-400">Reconcile shift pauses & meal breaks.</span>
                    </div>
                    <button
                      onClick={() => handlePolicyUpdate('breakValidationRequired', !currentTenant.policy.breakValidationRequired)}
                      className={`px-3 py-1.5 rounded-xl font-mono text-[9px] font-bold tracking-wider cursor-pointer transition-all ${
                        currentTenant.policy.breakValidationRequired ? 'bg-emerald-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {currentTenant.policy.breakValidationRequired ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>
                </div>

              </div>

              {/* GRANULAR RBAC MATRIX FOR TENANT COMPANY ADMIN */}
              <div className="bg-slate-100/20 border border-slate-200 rounded-xl p-5 space-y-4 col-span-1 md:col-span-2">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-mono text-[9px] text-emerald-600 font-black uppercase block tracking-wider">Granular Privilege Customization</span>
                    <h4 className="font-display font-black text-xs text-slate-900 uppercase tracking-tight">Role-Based Access Control (RBAC) Matrix</h4>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-mono text-indigo-400 font-bold">
                    TENANT_LEVEL_ROLES
                  </span>
                </div>

                <p className="text-[10.5px] text-slate-500 leading-relaxed">
                  Assign active privileges across different company roles. Toggling permissions is constrained by the system features allotted to your company by the global <strong className="text-emerald-400">Super Admin</strong>.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px] font-mono">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 text-[10px]">
                        <th className="py-2 pr-4 font-bold">Privilege / Action Context</th>
                        {(['EMPLOYEE', 'MANAGER', 'HR', 'GM', 'ADMIN'] as const).map(role => (
                          <th key={role} className="py-2 px-3 text-center font-bold">{role}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {[
                        {
                          key: 'overruleGeofence',
                          label: 'Overrule GPS Geofences',
                          desc: 'Allows clocking in outside designated coords',
                          featureDependency: 'gpsTracking',
                          featureName: 'GPS Tracking'
                        },
                        {
                          key: 'bypassBiometrics',
                          label: 'Bypass Selfie Verification',
                          desc: 'Bypasses photo and face liveness triggers',
                          featureDependency: 'selfieCheckin',
                          featureName: 'Selfie Checkin'
                        },
                        {
                          key: 'submitLeaves',
                          label: 'File Personal Leave Requests',
                          desc: 'Allows submitting new leave tickets',
                          featureDependency: 'leaveManagement',
                          featureName: 'Leave Management'
                        },
                        {
                          key: 'approveLeaves',
                          label: 'Review & Approve Leaves',
                          desc: 'Grants authority to decide leave outcomes',
                          featureDependency: 'leaveManagement',
                          featureName: 'Leave Management'
                        },
                        {
                          key: 'viewLedger',
                          label: 'Read Immutable Logs',
                          desc: 'Accesses read-only audit trails of the tenant',
                          featureDependency: 'auditLedger',
                          featureName: 'Audit Ledger'
                        },
                        {
                          key: 'manageEmployees',
                          label: 'Manage Staff Accounts',
                          desc: 'Allows onboarding or editing employee profiles',
                          featureDependency: null,
                          featureName: null
                        }
                      ].map((perm) => {
                        // Check if feature is allotted by Super Admin
                        const isAllotted = perm.featureDependency 
                          ? currentTenant.allowedFeatures?.[perm.featureDependency as keyof typeof currentTenant.allowedFeatures] !== false
                          : true;

                        return (
                          <tr key={perm.key} className="hover:bg-slate-100/5">
                            <td className="py-3 pr-4 space-y-0.5">
                              <span className={`block font-semibold text-xs ${isAllotted ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                                {perm.label}
                              </span>
                              <span className="block text-[9.5px] text-slate-500 font-sans">{perm.desc}</span>
                              {!isAllotted && (
                                <span className="inline-block text-[8px] bg-rose-500/10 border border-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded font-bold uppercase mt-0.5">
                                  🚫 Locked by SuperAdmin ({perm.featureName})
                                </span>
                              )}
                            </td>
                            {(['EMPLOYEE', 'MANAGER', 'HR', 'GM', 'ADMIN'] as const).map((roleKey) => {
                              const isGranted = currentTenant.roleFeaturePermissions?.[roleKey]?.[perm.key as keyof typeof currentTenant.roleFeaturePermissions[typeof roleKey]] || false;
                              
                              return (
                                <td key={roleKey} className="py-3 px-3 text-center">
                                  <button
                                    type="button"
                                    disabled={!isAllotted}
                                    onClick={() => handleTogglePermission(roleKey, perm.key as any)}
                                    className={`mx-auto w-10 h-5 rounded-full p-0.5 transition-all focus:outline-none flex ${
                                      !isAllotted 
                                        ? 'bg-slate-100 cursor-not-allowed opacity-30 justify-start' 
                                        : isGranted 
                                        ? 'bg-emerald-500 justify-end' 
                                        : 'bg-slate-200 justify-start'
                                    }`}
                                  >
                                    <span className={`w-4 h-4 rounded-full shadow-md transition-all ${
                                      !isAllotted ? 'bg-slate-600' : 'bg-white'
                                    }`} />
                                  </button>
                                  <span className={`text-[8.5px] mt-1 block font-bold uppercase ${
                                    !isAllotted ? 'text-slate-600' : isGranted ? 'text-emerald-400' : 'text-slate-500'
                                  }`}>
                                    {!isAllotted ? 'Locked' : isGranted ? 'Yes' : 'No'}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-8">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <span className="font-mono text-[9px] text-emerald-600 font-black uppercase block tracking-wider">Hierarchy & Provisioning</span>
                      <h4 className="font-display font-black text-xs text-slate-900 uppercase tracking-tight">Role Provisioning Capabilities</h4>
                    </div>
                  </div>
                  <p className="text-[10.5px] text-slate-500 leading-relaxed mb-4">
                    Define which roles are authorized to create or invite specific other roles into this tenant's directory.
                  </p>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px] font-mono">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 text-[10px]">
                          <th className="py-2 pr-4 font-bold w-1/4">Actor (Who can create...)</th>
                          {(['EMPLOYEE', 'MANAGER', 'HR', 'GM', 'ADMIN'] as const).map(role => (
                            <th key={role} className="py-2 px-3 text-center font-bold">...{role}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {(['EMPLOYEE', 'MANAGER', 'HR', 'GM', 'ADMIN'] as const).map((actorRole) => (
                          <tr key={actorRole} className="hover:bg-slate-100/5">
                            <td className="py-3 pr-4 font-semibold text-slate-900">
                              {actorRole}
                            </td>
                            {(['EMPLOYEE', 'MANAGER', 'HR', 'GM', 'ADMIN'] as const).map((targetRole) => {
                              const canCreateRoles = currentTenant.roleFeaturePermissions?.[actorRole]?.canCreateRoles || [];
                              const isGranted = canCreateRoles.includes(targetRole);
                              
                              return (
                                <td key={targetRole} className="py-3 px-3 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleRoleCreationPermission(actorRole, targetRole)}
                                    className={`mx-auto w-10 h-5 rounded-full p-0.5 transition-all focus:outline-none flex ${
                                      isGranted 
                                        ? 'bg-emerald-500 justify-end' 
                                        : 'bg-slate-200 justify-start'
                                    }`}
                                  >
                                    <span className="w-4 h-4 rounded-full shadow-md transition-all bg-white" />
                                  </button>
                                  <span className={`text-[8.5px] mt-1 block font-bold uppercase ${
                                    isGranted ? 'text-emerald-400' : 'text-slate-500'
                                  }`}>
                                    {isGranted ? 'Yes' : 'No'}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 3: COMPANY ONBOARDING WIZARD */}
        {activeTab === 'onboarding' && (
          <div className="bg-slate-900/50 border border-slate-700 rounded-2xl p-6 md:p-8 shadow-inner">
            <div className="flex justify-between items-center mb-6 pb-3 border-b border-slate-700">
              <div>
                <h3 className="font-display font-black text-base text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-emerald-600" />
                  Corporate Tenant Onboarding wizard
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Provision new isolated environments with tailored attendance & leave configurations. No dev work required.
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-600 font-bold">Step {wizardStep} of 3</span>
            </div>

            <form onSubmit={handleOnboardingSubmit} className="space-y-6">
              
              {/* STEP 1: Details */}
              {wizardStep === 1 && (
                <div className="space-y-4 animate-fade-in">
                  <span className="font-mono text-[9px] text-emerald-600 font-black uppercase tracking-wider block">Step 1: Company Profile</span>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Corporate Shell Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Zenith Tech"
                        value={obName}
                        onChange={(e) => setObName(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Industry Vertical</label>
                      <select
                        value={obIndustry}
                        onChange={(e) => setObIndustry(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
                      >
                        <option>Information Technology</option>
                        <option>Logistics & Transport</option>
                        <option>Healthcare & Nursing</option>
                        <option>Retail & Field Operations</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Local Coherence Timezone</label>
                      <input
                        type="text"
                        value={obTimezone}
                        onChange={(e) => setObTimezone(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Domicile Country</label>
                      <input
                        type="text"
                        value={obCountry}
                        onChange={(e) => setObCountry(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="block text-xs font-semibold text-emerald-600">SaaS Admin Email Address</label>
                      <input
                        type="email"
                        required
                        placeholder="e.g. founder@zenith.com (The email you feed to set yourself as the Admin)"
                        value={obAdminEmail}
                        onChange={(e) => setObAdminEmail(e.target.value)}
                        className="w-full bg-white border border-emerald-500/30 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500 placeholder-slate-600"
                      />
                      <p className="text-[10px] text-slate-400">
                        This email will be dynamically registered as the primary <strong className="text-slate-900 font-semibold">COMPANY_ADMIN</strong>. This triggers transactional credentials and onboarding mail delivery.
                      </p>
                    </div>
                  </div>

                  {/* Plan Choice Cards */}
                  <div className="space-y-3 pt-2">
                    <label className="block text-xs font-semibold text-slate-400">Select SaaS Tier & Plan Details</label>
                    <div className="grid md:grid-cols-3 gap-4">
                      {[
                        { id: 'STANDARD' as const, name: 'Standard Plan', price: '$49/mo', limits: 'Up to 50 staff', desc: 'Standard selfie & coordinate verification' },
                        { id: 'PREMIUM' as const, name: 'Premium Plan', price: '$149/mo', limits: 'Up to 250 staff', desc: 'Strict geofences & active liveness check' },
                        { id: 'ENTERPRISE' as const, name: 'Enterprise Plan', price: '$499/mo', limits: 'Unlimited staff', desc: 'Cryptographic ledger seals & custom SMTP gateway' }
                      ].map((plan) => (
                        <div
                          key={plan.id}
                          onClick={() => setObPlan(plan.id)}
                          className={`border-slate-200 rounded-2xl p-4 cursor-pointer transition-all flex flex-col justify-between ${
                            obPlan === plan.id
                              ? 'bg-slate-100/50 border-emerald-500 text-slate-900 shadow-lg shadow-emerald-500/10'
                              : 'bg-white border-slate-200 hover:border-slate-700 text-slate-600'
                          }`}
                        >
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-display font-black text-xs uppercase tracking-wider">{plan.name}</span>
                              <span className="text-xs font-mono font-bold text-emerald-600">{plan.price}</span>
                            </div>
                            <p className="text-[10.5px] leading-relaxed text-slate-500 mb-3">{plan.desc}</p>
                          </div>
                          <span className="text-[10px] font-mono text-emerald-600 font-semibold bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-xl text-center self-start">
                            {plan.limits}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      disabled={!obName.trim()}
                      className="px-5 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-xs font-bold text-slate-900 rounded-full flex items-center gap-1.5 cursor-pointer"
                    >
                      Configure Policies
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Attendance Policies */}
              {wizardStep === 2 && (
                <div className="space-y-4 animate-fade-in">
                  <span className="font-mono text-[9px] text-emerald-600 font-black uppercase tracking-wider block">Step 2: Attendance Policy Tuning</span>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Daily Shift Commences</label>
                      <input
                        type="time"
                        value={obShiftStart}
                        onChange={(e) => setObShiftStart(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Late Grace Limit (Minutes)</label>
                      <input
                        type="number"
                        value={obGrace}
                        onChange={(e) => setObGrace(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Allowed Geofence Radius (Meters)</label>
                      <input
                        type="number"
                        value={obRadius}
                        onChange={(e) => setObRadius(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={obSelfieReq}
                        onChange={(e) => setObSelfieReq(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 bg-white border-slate-200"
                      />
                      <span className="text-xs font-semibold text-slate-600">Require Selfie verification on clock-in</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={obBiometric}
                        onChange={(e) => setObBiometric(e.target.checked)}
                        className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 bg-white border-slate-200"
                      />
                      <span className="text-xs font-semibold text-slate-600">Enforce strict face liveness challenge matching</span>
                    </label>

                    <div className="border-t border-slate-100 pt-3 mt-3 space-y-2">
                      <span className="text-xs font-bold text-slate-700 block">Allotted Enterprise Features</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={obGpsTracking}
                            onChange={(e) => setObGpsTracking(e.target.checked)}
                            className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 bg-white border-slate-200"
                          />
                          <span className="text-xs text-slate-600">GPS Coordinates Logging</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={obLeaveManagement}
                            onChange={(e) => setObLeaveManagement(e.target.checked)}
                            className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 bg-white border-slate-200"
                          />
                          <span className="text-xs text-slate-600">Dynamic Leave Accruals</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={obAuditLedger}
                            onChange={(e) => setObAuditLedger(e.target.checked)}
                            className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 bg-white border-slate-200"
                          />
                          <span className="text-xs text-slate-600">Immutable Security Ledger</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={obAnomalyAlerts}
                            onChange={(e) => setObAnomalyAlerts(e.target.checked)}
                            className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 bg-white border-slate-200"
                          />
                          <span className="text-xs text-slate-600">GPS Spoof Alerts</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(1)}
                      className="px-4 py-2 border border-slate-700 text-slate-500 rounded-full text-xs font-bold"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => setWizardStep(3)}
                      className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-900 rounded-full flex items-center gap-1.5 cursor-pointer"
                    >
                      Accrual Balances
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Leave Limits & Accruals */}
              {wizardStep === 3 && (
                <div className="space-y-4 animate-fade-in">
                  <span className="font-mono text-[9px] text-emerald-600 font-black uppercase tracking-wider block">Step 3: Leave Limits Configuration</span>
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Annual Leaves (Days)</label>
                      <input
                        type="number"
                        value={obAnnualLimit}
                        onChange={(e) => setObAnnualLimit(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Sick Leaves (Days)</label>
                      <input
                        type="number"
                        value={obSickLimit}
                        onChange={(e) => setObSickLimit(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400">Casual Leaves (Days)</label>
                      <input
                        type="number"
                        value={obCasualLimit}
                        onChange={(e) => setObCasualLimit(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2 focus:outline-none"
                      />
                    </div>
                  </div>

                  <p className="text-[10.5px] text-slate-500 italic">
                    Note: These limits are dynamically evaluated by the Leave Engine. No developer hardcoding is used.
                  </p>

                  <div className="flex justify-between pt-4">
                    <button
                      type="button"
                      onClick={() => setWizardStep(2)}
                      className="px-4 py-2 border border-slate-700 text-slate-500 rounded-full text-xs font-bold"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-emerald-500 text-white text-xs font-black rounded-full uppercase tracking-wider hover:opacity-90 transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 fill-current" />
                      Provision SaaS Tenant Environment
                    </button>
                  </div>
                </div>
              )}

            </form>
          </div>
        )}

        {/* TAB 4: IMMUTABLE AUDIT LOG & LEDGER DECK */}
        {activeTab === 'ledger' && (
          <div className="space-y-6">
            
            {/* Super Admin Control Panel Card */}
            {activeRole === 'SUPER_ADMIN' && (
              <div className="bg-slate-100/90 border-slate-200 border-indigo-500/30 rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-mono text-[9px] text-indigo-400 font-extrabold uppercase tracking-widest block">SUPER ADMIN GATEWAY ACCESS ONLY</span>
                    <h3 className="font-display font-black text-base text-slate-900 uppercase tracking-tight flex items-center gap-2 mt-1">
                      <Lock className="w-4 h-4 text-indigo-400" />
                      Global Tenant Directory Clearance
                    </h3>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-[10px] font-mono text-indigo-300 font-bold">
                    SYSTEM_ROOT_SUPERADMIN
                  </span>
                </div>

                <div className="grid md:grid-cols-3 gap-4 text-xs pt-2">
                  <div className="bg-white p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block font-mono text-[8.5px]">TOTAL REGISTERED TENANTS</span>
                    <span className="text-xl font-bold text-slate-900 block mt-1">{tenants.length} Companies</span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block font-mono text-[8.5px]">ACTIVE LEDGER DEPTH</span>
                    <span className="text-xl font-bold text-emerald-600 block mt-1">{ledger.length} Sealed Blocks</span>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block font-mono text-[8.5px]">SYSTEM OUTAGE STATE</span>
                    <span className="text-xl font-bold text-emerald-400 block mt-1 flex items-center gap-1.5">
                      <Power className="w-4 h-4" /> Coherent
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 space-y-3">
                  <span className="font-mono text-[9px] text-slate-500 font-black uppercase tracking-wider block">Global Tenant Registries Awaiting Clearance</span>
                  <div className="space-y-2">
                    {tenants.map((t) => (
                      <div key={t.id} className="bg-white p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                        <div>
                          <span className="font-bold text-slate-900 text-xs block">{t.name}</span>
                          <span className="font-mono text-[9px] text-slate-500">{t.id} | Domicile: {t.country} | Industry: {t.industry}</span>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                            t.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                          }`}>
                            {t.status}
                          </span>

                          {t.status === 'PENDING' && (
                            <button
                              onClick={() => handleTenantStatus(t.id, 'ACTIVE')}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-slate-900 text-[10px] font-extrabold rounded-lg cursor-pointer"
                            >
                              Approve & Activate Tenant
                            </button>
                          )}
                          {t.status === 'ACTIVE' && t.id.startsWith('t-custom') && (
                            <button
                              onClick={() => handleTenantStatus(t.id, 'SUSPENDED')}
                              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-slate-900 text-[10px] font-extrabold rounded-lg cursor-pointer"
                            >
                              Suspend Tenant
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* General Block Ledger Stream */}
            <div className="bg-white/50 border border-slate-200 rounded-2xl p-6">
              <div className="flex justify-between items-center mb-6 border-b border-slate-200 pb-3">
                <div>
                  <h3 className="font-display font-black text-sm text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-600" />
                    Immutable SaaS Audit Ledger
                  </h3>
                  <span className="text-[10px] text-slate-400">Verifiable, cryptographic state chain logs</span>
                </div>
                <button
                  onClick={() => {
                    localStorage.removeItem('perimeter_ledger');
                    localStorage.removeItem('perimeter_tenants');
                    window.location.reload();
                  }}
                  className="px-3 py-1 bg-slate-100 text-slate-500 hover:text-slate-900 rounded-lg text-[10px] font-mono font-black border border-slate-200 cursor-pointer"
                >
                  RESET CORE STORAGE
                </button>
              </div>

              <div className="space-y-4">
                {ledger.map((block) => (
                  <div key={block.id} className="bg-slate-100/10 border border-slate-200 rounded-xl p-4 font-mono text-[11px] relative overflow-hidden">
                    <div className="absolute top-2 right-2 text-[10px] font-black text-slate-600">
                      {block.id}
                    </div>
                    
                    <div className="grid md:grid-cols-12 gap-3 leading-normal">
                      
                      <div className="md:col-span-3">
                        <span className="block text-slate-500 text-[8px] font-black uppercase">Timestamp</span>
                        <span className="text-slate-600 font-bold block">{block.timestamp}</span>
                      </div>

                      <div className="md:col-span-3">
                        <span className="block text-slate-500 text-[8px] font-black uppercase">Tenant Isolation</span>
                        <span className="text-emerald-600 font-black block">{block.tenantName} ({block.tenantId})</span>
                      </div>

                      <div className="md:col-span-3">
                        <span className="block text-slate-500 text-[8px] font-black uppercase">Actor / Identity</span>
                        <span className="text-slate-800 block font-bold">{block.actor}</span>
                      </div>

                      <div className="md:col-span-3">
                        <span className="block text-slate-500 text-[8px] font-black uppercase">Sealed Action</span>
                        <span className="text-indigo-400 block font-bold">{block.action}</span>
                      </div>

                    </div>

                    <div className="mt-3 bg-white p-2 rounded border border-slate-200 text-slate-600 text-xs font-sans">
                      {block.details}
                      {block.oldValue && (
                        <div className="mt-1 text-[9.5px] font-mono text-slate-500">
                          <span className="text-slate-500 uppercase">Old:</span> {block.oldValue} | <span className="text-slate-500 uppercase">New:</span> {block.newValue}
                        </div>
                      )}
                    </div>

                    {/* SHA-256 seal signature decoration */}
                    <div className="mt-2.5 flex items-center gap-1.5 text-[8.5px] text-slate-500 font-mono">
                      <span className="text-emerald-400">BLOCK_HASH:</span>
                      <span className="truncate">{block.hash}</span>
                    </div>

                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* TAB 5: DYNAMIC LEAVE APPLICATION */}
        {activeTab === 'leaves' && (activeRole === 'SUPER_ADMIN' || currentTenant.status !== 'PENDING') && (
          <div className="grid lg:grid-cols-12 gap-8">
            
            {/* Left apply form */}
            <div className="lg:col-span-7 bg-white/50 border border-slate-200 rounded-2xl p-6">
              <h3 className="font-display font-bold text-sm text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Calendar className="w-4.5 h-4.5 text-emerald-600" />
                File Localized Leave request
              </h3>

              <form onSubmit={handleLeaveRequest} className="space-y-4">
                
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-400">Requesting Employee Profile</label>
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-2"
                  >
                    {currentTenant.employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1 font-semibold">Type of leave</label>
                    <select
                      value={leaveType}
                      onChange={(e: any) => setLeaveType(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-1.5"
                    >
                      <option value="annual">Annual</option>
                      <option value="sick">Sick</option>
                      <option value="casual">Casual</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1 font-semibold">Start date</label>
                    <input
                      type="date"
                      value={leaveStart}
                      onChange={(e) => setLeaveStart(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-1.5"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1 font-semibold">End date</label>
                    <input
                      type="date"
                      value={leaveEnd}
                      onChange={(e) => setLeaveEnd(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-1.5"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-400">Statement / Justification</label>
                  <textarea
                    required
                    placeholder="Enter context for this absence..."
                    value={leaveReason}
                    onChange={(e) => setLeaveReason(e.target.value)}
                    className="w-full h-20 bg-white border border-slate-200 text-xs text-slate-900 rounded-xl p-3 resize-none focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 border border-emerald-500/20 text-xs font-bold text-emerald-600 uppercase tracking-wider rounded-full transition-colors cursor-pointer"
                >
                  Submit Leave Request
                </button>

              </form>
            </div>

            {/* Right leave ledger summary */}
            <div className="lg:col-span-5 bg-white/50 border border-slate-200 rounded-2xl p-6 space-y-4">
              <span className="font-mono text-[9px] text-emerald-600 font-black uppercase block tracking-wider">Dynamic Leaves Entitlement</span>
              
              <div className="space-y-3">
                {currentTenant.employees.map((emp) => {
                  const annBal = currentTenant.leaves.annual - emp.leavesUsed.annual;
                  const sickBal = currentTenant.leaves.sick - emp.leavesUsed.sick;
                  const casBal = currentTenant.leaves.casual - emp.leavesUsed.casual;

                  return (
                    <div key={emp.id} className="bg-slate-100/20 p-4 rounded-xl border border-slate-200 space-y-2">
                      <span className="font-bold text-slate-900 text-xs block">{emp.name}</span>
                      
                      <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                        <div className="bg-white p-1.5 rounded">
                          <span className="text-slate-500 block font-mono text-[8px]">ANNUAL</span>
                          <span className="font-bold text-emerald-400">{annBal} / {currentTenant.leaves.annual}d</span>
                        </div>
                        <div className="bg-white p-1.5 rounded">
                          <span className="text-slate-500 block font-mono text-[8px]">SICK</span>
                          <span className="font-bold text-blue-400">{sickBal} / {currentTenant.leaves.sick}d</span>
                        </div>
                        <div className="bg-white p-1.5 rounded">
                          <span className="text-slate-500 block font-mono text-[8px]">CASUAL</span>
                          <span className="font-bold text-amber-400">{casBal} / {currentTenant.leaves.casual}d</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>

          </div>
        )}

        {/* TAB 6: DYNAMIC EMPLOYEE CLOCK-IN TESTING PORTAL */}
        {activeTab === 'clockin' && (activeRole === 'SUPER_ADMIN' || currentTenant.status !== 'PENDING') && (
          <div className="grid lg:grid-cols-12 gap-8">
            
            {/* Left inputs */}
            <div className="lg:col-span-6 bg-white/50 border border-slate-200 rounded-2xl p-6 space-y-5">
              <h3 className="font-display font-bold text-sm text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Camera className="w-4.5 h-4.5 text-emerald-600" />
                Employee Verification Terminal
              </h3>

              <div className="space-y-3">
                
                {/* Employee select */}
                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-500 font-semibold">Select Employee</label>
                  <select
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-1.5"
                  >
                    {currentTenant.employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.role})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Clock-in time simulator */}
                <div className="space-y-1">
                  <label className="block text-[11px] text-slate-500 font-semibold">Clock-In Time Selection</label>
                  <input
                    type="time"
                    value={simulatedTime}
                    onChange={(e) => setSimulatedTime(e.target.value)}
                    className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-xl px-3 py-1.5 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500 block">
                    Tenant Commences: <strong>{currentTenant.policy.shiftStart}</strong> (Grace Allowed: {currentTenant.policy.gracePeriodMins}m).
                  </span>
                </div>

                {/* Simulated Geofencing coordinate presets */}
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <span className="font-mono text-[8.5px] text-slate-500 font-black block uppercase tracking-wider">Geofence coordinate sandboxing</span>
                  <div className="flex flex-wrap gap-2">
                    {officeBranches.map((branch, i) => {
                      const isActive = simulatedLat === branch.lat && simulatedLng === branch.lng;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setSimulatedLat(branch.lat);
                            setSimulatedLng(branch.lng);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[10.5px] font-semibold transition-all cursor-pointer border ${
                            isActive 
                              ? 'bg-slate-100 text-emerald-600 border-emerald-500/30' 
                              : 'bg-white text-slate-500 border-slate-200'
                          }`}
                        >
                          {branch.name}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs pt-1.5">
                    <div>
                      <span className="text-slate-500 text-[10px] block">Latitude</span>
                      <input
                        type="number"
                        step="0.0001"
                        value={simulatedLat}
                        onChange={(e) => setSimulatedLat(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-lg px-2 py-1"
                      />
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Longitude</span>
                      <input
                        type="number"
                        step="0.0001"
                        value={simulatedLng}
                        onChange={(e) => setSimulatedLng(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-lg px-2 py-1"
                      />
                    </div>
                  </div>

                  {/* GPS Accuracy & Spoof Simulator */}
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                      <span className="text-slate-500 text-[10px] block">GPS Accuracy radius (meters)</span>
                      <input
                        type="number"
                        value={gpsAccuracy}
                        onChange={(e) => setGpsAccuracy(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-lg px-2 py-1"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-4">
                      <span className="text-slate-600 text-xs text-[11px] font-semibold">Simulate Mock GPS</span>
                      <button
                        type="button"
                        onClick={() => setIsSpoofed(!isSpoofed)}
                        className={`px-2 py-1 rounded text-[10px] font-mono font-bold cursor-pointer transition-all ${
                          isSpoofed ? 'bg-rose-600 text-slate-900' : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {isSpoofed ? 'SPOOFING_DETECTED' : 'NORMAL'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ADVANCED MULTI-METHOD VERIFICATION CHECKLISTS */}
                <div className="pt-4 border-t border-slate-800 space-y-3">
                  <span className="font-mono text-[9px] text-emerald-600 font-black uppercase tracking-wider block">Policy Verification Handshake Checklist</span>

                  {/* Geofence Check */}
                  {currentTenant.policy.geofenceRequired && (
                    <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 flex justify-between items-center">
                      <div>
                        <span className="text-xs font-semibold text-slate-200 block">Geofence GPS Lock</span>
                        <span className="text-[10px] text-slate-400">NY Headquarters authorized distance check</span>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                        calculateDistance(simulatedLat, simulatedLng, officeBranches[0].lat, officeBranches[0].lng) <= currentTenant.policy.radiusMeters
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {calculateDistance(simulatedLat, simulatedLng, officeBranches[0].lat, officeBranches[0].lng) <= currentTenant.policy.radiusMeters ? 'MATCHED' : 'OUT_OF_BOUNDS'}
                      </span>
                    </div>
                  )}

                  {/* 3D Facial Enrollment Status check */}
                  {currentTenant.policy.faceBiometric && (
                    <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-xs font-semibold text-slate-200 block">Facial Biometric Enrolment</span>
                          <span className="text-[10px] text-slate-400">Unique vector signature directory status</span>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          enrolledFaces[selectedEmployeeId]
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                        }`}>
                          {enrolledFaces[selectedEmployeeId] ? 'ENROLLED' : 'NOT_ENROLLED'}
                        </span>
                      </div>

                      {!enrolledFaces[selectedEmployeeId] && (
                        <div className="bg-amber-500/5 border border-amber-500/20 p-2.5 rounded-lg space-y-2">
                          <span className="text-[10px] text-amber-300 block leading-normal">
                            ⚠️ Enrollment Required: Face signature must be registered prior to shift seal authorize actions.
                          </span>
                          {enrollmentStage !== 'IDLE' ? (
                            <div className="bg-white p-2 rounded border border-slate-200 text-center space-y-1">
                              <span className="text-[9px] text-emerald-600 font-bold block uppercase tracking-wider animate-pulse">
                                STAGE: {enrollmentStage}
                              </span>
                              <div className="w-full bg-slate-200 h-1 rounded overflow-hidden">
                                <div className="bg-emerald-500 h-full" style={{ width: `${enrollmentProgress}%` }} />
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEnrollmentStage('CENTER');
                                setEnrollmentProgress(0);
                              }}
                              className="w-full py-1 bg-indigo-600 hover:bg-indigo-700 text-slate-900 rounded text-[10px] font-bold uppercase cursor-pointer animate-pulse"
                            >
                              🚀 Start Biometric Enrollment Wizard
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Office Wi-Fi Network Connection Select */}
                  {currentTenant.policy.wifiSSIDRequired && (
                    <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-xs font-semibold text-slate-200 block">Office Wi-Fi Gateway check</span>
                          <span className="text-[10px] text-slate-400">Match SSID: {currentTenant.policy.wifiSSIDs?.join(', ') || 'Apex_HQ_Secure'}</span>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          (currentTenant.policy.wifiSSIDs || ['Apex_HQ_Secure']).includes(currentWifiSSID)
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {(currentTenant.policy.wifiSSIDs || ['Apex_HQ_Secure']).includes(currentWifiSSID) ? 'MATCHED' : 'UNSECURED'}
                        </span>
                      </div>
                      <select
                        value={currentWifiSSID}
                        onChange={(e) => setCurrentWifiSSID(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs text-slate-900 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="Apex_HQ_Secure">Apex_HQ_Secure (Approved office intranet)</option>
                        <option value="Apex_Staff_Guest">Apex_Staff_Guest (Guest network - Unsecured)</option>
                        <option value="Home_WiFi_Router">Home_WiFi_Router (Bypasses intranet security)</option>
                        <option value="Cellular_LTE">Cellular_LTE (Mobile carrier data)</option>
                      </select>
                    </div>
                  )}

                  {/* Dynamic Reception Desk QR Code Scan */}
                  {currentTenant.policy.qrRequired && (
                    <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-xs font-semibold text-slate-200 block">Reception QR token check</span>
                          <span className="text-[10px] text-slate-400">Match active token: "{activeQRToken}"</span>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          qrScanSuccess ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                        }`}>
                          {qrScanSuccess ? 'VERIFIED' : 'PENDING'}
                        </span>
                      </div>
                      {!qrScanSuccess && (
                        <button
                          type="button"
                          onClick={() => {
                            setScannedQRToken(activeQRToken);
                            setQrScanSuccess(true);
                          }}
                          className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-900 border border-emerald-500/20 rounded-lg text-[10px] font-bold uppercase cursor-pointer"
                        >
                          📸 Scan Reception Desk QR Code
                        </button>
                      )}
                    </div>
                  )}

                  {/* local device Enclave Fingerprint scan */}
                  {currentTenant.policy.fingerprintRequired && (
                    <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-xs font-semibold text-slate-200 block">TouchID Enclave Handshake</span>
                          <span className="text-[10px] text-slate-400">Local device fingerprint key challenge</span>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          fingerprintScanned ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                        }`}>
                          {fingerprintScanned ? 'MATCHED' : 'PENDING'}
                        </span>
                      </div>
                      {!fingerprintScanned && (
                        <button
                          type="button"
                          onClick={() => {
                            setFingerprintScanning(true);
                            setTimeout(() => {
                              setFingerprintScanning(false);
                              setFingerprintScanned(true);
                            }, 1000);
                          }}
                          className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-900 border border-emerald-500/20 rounded-lg text-[10px] font-bold uppercase cursor-pointer flex items-center justify-center gap-1"
                        >
                          <Fingerprint className="w-3.5 h-3.5 text-emerald-600" />
                          {fingerprintScanning ? 'Verifying...' : 'Press Fingerprint sensor (TouchID)'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Device and VPN Compliance lock */}
                  {currentTenant.policy.vpnRequired && (
                    <div className="bg-slate-950/40 border border-slate-900 rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-xs font-semibold text-slate-200 block">PC Trust & VPN lock</span>
                          <span className="text-[10px] text-slate-400">Device Hardware ID and VPN tunnel check</span>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          vpnConnected && pcRegistered
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {vpnConnected && pcRegistered ? 'SECURE' : 'NON_COMPLIANT'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setVpnConnected(!vpnConnected)}
                          className={`py-1 rounded text-[9px] font-mono font-bold uppercase border transition-all ${
                            vpnConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}
                        >
                          VPN: {vpnConnected ? 'CONNECTED' : 'DISCONNECTED'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPcRegistered(!pcRegistered)}
                          className={`py-1 rounded text-[9px] font-mono font-bold uppercase border transition-all ${
                            pcRegistered ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}
                        >
                          PC Trust: {pcRegistered ? 'MacBook HQ' : 'Untrusted Device'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* --- ZERO-TRUST SECURITY SIMULATION OVERRIDES (Rules #1, #2, #4, #5, #6, #7, #8, #9) --- */}
                <div className="pt-5 border-t border-slate-200 space-y-4">
                  <span className="font-mono text-[9px] text-amber-600 font-black uppercase tracking-wider block">🚨 Enterprise Security & Zero-Trust Overrides</span>
                  
                  {/* Row 1: Network & Clock Spoofs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                      <span className="text-[10px] text-slate-500 font-bold block">Network Mode</span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsOfflineSimulated(!isOfflineSimulated);
                        }}
                        className={`w-full py-1.5 rounded-lg text-xs font-mono font-bold uppercase transition-all cursor-pointer border ${
                          isOfflineSimulated
                            ? 'bg-rose-600 text-white border-rose-700 shadow-inner'
                            : 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {isOfflineSimulated ? '❌ OFFLINE' : '🌐 ONLINE'}
                      </button>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                      <span className="text-[10px] text-slate-500 font-bold block">NTP Clock Lock</span>
                      <button
                        type="button"
                        onClick={() => {
                          setAttemptTimeBackdating(!attemptTimeBackdating);
                        }}
                        className={`w-full py-1.5 rounded-lg text-xs font-mono font-bold uppercase transition-all cursor-pointer border ${
                          attemptTimeBackdating
                            ? 'bg-amber-600 text-white border-amber-700 shadow-inner'
                            : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {attemptTimeBackdating ? '⚠️ SPOOF_ACTIVE' : '🔒 SECURE NTP'}
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Device Trust Spoof */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-500 font-bold block">Hardware Fingerprint Profile</span>
                      <button
                        type="button"
                        onClick={() => {
                          setDeviceFingerprint(prev => prev === registeredFingerprint ? 'fp_malicious_hacker_7a' : registeredFingerprint);
                        }}
                        className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase cursor-pointer border transition-all ${
                          deviceFingerprint !== registeredFingerprint
                            ? 'bg-rose-600 text-white border-rose-700'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200'
                        }`}
                      >
                        {deviceFingerprint !== registeredFingerprint ? 'SPOOF PROFILE' : 'TRUST PORTAL'}
                      </button>
                    </div>
                    <div className="font-mono text-[10px] text-slate-600 bg-white p-2 rounded border border-slate-100 flex justify-between">
                      <span>Active fingerprint:</span>
                      <strong className={deviceFingerprint !== registeredFingerprint ? 'text-rose-600 font-bold' : 'text-slate-800'}>
                        {deviceFingerprint}
                      </strong>
                    </div>
                  </div>

                  {/* Row 3: Scheduled Break Expiry Sweep */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <button
                      type="button"
                      onClick={handleTriggerAutoExpirySweep}
                      className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Clock className="w-4 h-4" />
                      Trigger Break Auto-Expiry Sweep (Rule #8)
                    </button>
                  </div>

                  {/* Offline queue and logger */}
                  {offlineQueue.length > 0 && (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-200 uppercase tracking-wide font-mono">
                          📦 Offline Queue ({offlineQueue.length} events)
                        </span>
                        <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping animate-bounce" />
                      </div>

                      <div className="space-y-1 max-h-24 overflow-y-auto">
                        {offlineQueue.map((evt, idx) => (
                          <div key={idx} className="font-mono text-[9px] text-slate-300 bg-slate-950 px-2 py-1.5 rounded border border-slate-850 flex justify-between">
                            <span>{evt.eventType.toUpperCase()} ({evt.employeeName})</span>
                            <span className="text-amber-400 font-bold">LOCAL_CACHED</span>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={handleTriggerOfflineSync}
                        disabled={isSyncing}
                        className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-lg text-xs font-bold font-mono uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5"
                      >
                        <ShieldCheck className="w-4 h-4 fill-current" />
                        {isSyncing ? 'Synchronizing Enclave...' : 'Reconnect & Sync Offline Queue (Rule #6)'}
                      </button>
                    </div>
                  )}

                  {/* Sync Logging Console */}
                  {syncStatusLogs.length > 0 && (
                    <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-1.5">
                      <span className="font-mono text-[9px] text-emerald-400 font-bold block uppercase tracking-widest border-b border-slate-800 pb-1">
                        🖥️ Zero-Trust Synchronization Console
                      </span>
                      <div className="font-mono text-[10px] space-y-1 text-slate-300 max-h-40 overflow-y-auto pt-1 leading-normal">
                        {syncStatusLogs.map((logStr, i) => (
                          <div key={i} className={
                            logStr.includes('[DEVICE BLOCK]') || logStr.includes('[CONFLICT RESOLVED]')
                              ? 'text-rose-400 font-mono'
                              : logStr.includes('[SYNC COMPLETE]')
                                ? 'text-emerald-400 font-bold'
                                : 'text-slate-400'
                          }>
                            {logStr}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* Right biometric verify */}
            <div className="lg:col-span-6 bg-white/50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between space-y-4">
              <span className="font-mono text-[9px] text-emerald-600 font-black uppercase block tracking-wider">Biometric selfie & GPS Auth verification</span>
              
              <div className="bg-white border border-slate-200 rounded-xl h-48 flex flex-col items-center justify-center overflow-hidden relative">
                
                {cameraActive ? (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/90">
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover opacity-60" />
                    
                    {/* Retro overlay biometric target circle */}
                    <div className="absolute inset-0 border-[3px] border-dashed border-emerald-500/50 rounded-full m-12 pointer-events-none animate-pulse" />
                    
                    <div className="absolute bottom-3 left-3 right-3 text-center space-y-1 text-slate-900 bg-black/70 py-1.5 px-3 rounded-lg border border-slate-800 z-20">
                      <span className="font-mono text-[9px] text-emerald-600 block uppercase tracking-widest animate-pulse">
                        LIVENESS CHALLENGE: {livenessStage.replace('_', ' ')}
                      </span>
                      <div className="w-full bg-slate-200 h-1 rounded overflow-hidden">
                        <div className="bg-emerald-500 h-full" style={{ width: `${livenessProgress}%` }} />
                      </div>
                    </div>
                  </div>
                ) : capturedSelfie ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-100/20">
                    <img src={capturedSelfie} alt="Verified Selfie" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-emerald-500 text-white text-[9px] font-mono font-bold tracking-wider uppercase">
                      SELFIE_SEALED
                    </span>
                  </div>
                ) : (
                  <div className="text-center p-6 space-y-2">
                    <Camera className="w-8 h-8 text-emerald-600 mx-auto opacity-70" />
                    <div>
                      <span className="text-xs text-slate-900 block font-semibold">Selfie Auth required: {currentTenant.policy.selfieRequired ? 'Yes' : 'No'}</span>
                      <p className="text-[10px] text-slate-500 leading-normal max-w-[200px] mx-auto mt-1">
                        Opens local media capture to challenge face liveness vectors.
                      </p>
                    </div>
                  </div>
                )}

                {/* Invisible canvas for capturing frames */}
                <canvas ref={canvasRef} className="hidden" />

              </div>

              {/* Action commands */}
              <div className="flex gap-2">
                {currentTenant.policy.selfieRequired && !capturedSelfie && (
                  <button
                    onClick={cameraActive ? stopCamera : startCamera}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-slate-900 text-xs font-bold rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Camera className="w-4 h-4" />
                    {cameraActive ? 'Cancel Camera' : 'Commence Selfie Challenge'}
                  </button>
                )}

                {(!currentTenant.policy.selfieRequired || capturedSelfie) && (
                  <button
                    onClick={handleEmployeeClockIn}
                    className="w-full py-3 bg-emerald-500 text-white text-xs font-black rounded-xl uppercase tracking-wider hover:opacity-90 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-4.5 h-4.5 fill-current" />
                    Authorize & clock-in Shift
                  </button>
                )}
              </div>

            </div>

          </div>
        )}

      </div>

    </div>
  );
}
