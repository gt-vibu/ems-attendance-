import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import * as dotenv from 'dotenv';
import { buildLeaveIcs } from './api/services/ics.js';

// Load .env from monorepo root (relative to apps/admin cwd)
dotenv.config({ path: path.join(process.cwd(), '../../.env') });

// Confirmed (not just suspected) on this deployment: outbound SMTP to Gmail
// was failing with `connect ENETUNREACH <ipv6 address>` — Render's network
// has no outbound IPv6 route at all, but DNS still hands back an IPv6
// address for smtp.gmail.com as the preferred result, so every connection
// attempt hit that dead route first. Passing `family: 4` directly to
// nodemailer's transport options did NOT fix this — nodemailer/Node still
// tried IPv6, meaning that option isn't actually forwarded to the
// underlying socket the way a generic "pass everything through" assumption
// would suggest. This is the actual fix: dns.setDefaultResultOrder changes
// Node's global DNS resolution order for the whole process, which every
// dns.lookup()-based connection (nodemailer's SMTP transport included)
// respects regardless of what options each individual caller does or
// doesn't pass through. Available since Node 17; safe no-op on hosts that
// already have working IPv6.
dns.setDefaultResultOrder('ipv4first');

interface EmailAttachment {
  filename: string;
  content: string; // plain text content (e.g. an .ics file body)
  contentType: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface EmailResult {
  // 'simulated' means no real provider is configured (or all configured
  // providers failed) — the message was only written to emails/ on disk,
  // nobody actually received anything. Callers that promise the recipient
  // "an email was sent" (e.g. the hire flow) should check this before
  // claiming success.
  delivered: boolean;
  provider: 'resend' | 'smtp' | 'simulated';
}

export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  const { to, subject, text, html, attachments } = options;

  console.log(`\n==================================================`);
  console.log(`[EMAIL] To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`==================================================\n`);

  // Always save a local copy for debugging
  try {
    const emailsDir = path.join(process.cwd(), 'emails');
    if (!fs.existsSync(emailsDir)) fs.mkdirSync(emailsDir, { recursive: true });
    const filename = `email-${Date.now()}-${to.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
    const content = `Date: ${new Date().toISOString()}\nTo: ${to}\nSubject: ${subject}\n\nPLAIN TEXT:\n${text}\n\nHTML:\n${html}`;
    fs.writeFileSync(path.join(emailsDir, filename), content, 'utf8');
  } catch (err) {
    console.error('Failed to save email log:', err);
  }

  const resendKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM;
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || 'no-reply@smartteams.com';

  // --- OPTION 1: Resend API (recommended, works everywhere) ---
  if (resendKey && resendKey !== 'PASTE_RESEND_API_KEY_HERE') {
    // IMPORTANT: Resend requires the "from" address to be on a domain you've
    // verified with Resend (e.g. no-reply@yourdomain.com). A raw Gmail/Yahoo
    // address here will be rejected by Resend's API. Use RESEND_FROM, not
    // the SMTP_FROM value (that's only valid for the Gmail SMTP path below).
    if (!resendFrom) {
      console.error('[RESEND ERROR] RESEND_FROM is not set. Set it to a sender address on a domain verified with Resend (see https://resend.com/domains). Falling back to SMTP/simulation.');
    } else {
      try {
        const resend = new Resend(resendKey);
        const result: any = await resend.emails.send({
          from: `Smart Teams <${resendFrom}>`,
          to,
          subject,
          html,
          text,
          attachments: attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
        });
        if (result?.error) {
          throw new Error(result.error.message || JSON.stringify(result.error));
        }
        console.log(`[RESEND SUCCESS] Email sent to ${to}`);
        return { delivered: true, provider: 'resend' };
      } catch (err) {
        console.error(`[RESEND ERROR]`, err);
        // Fall through to SMTP / simulation instead of silently dropping the email.
      }
    }
  }

  // --- OPTION 2: SMTP (Gmail App Password / Ethereal) ---
  if (smtpHost && smtpUser && smtpPass &&
      smtpPass !== 'PASTE_YOUR_16_CHAR_APP_PASSWORD_HERE') {
    try {
      const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
      // Gmail displays App Passwords in 4-character groups (e.g. "abcd efgh
      // ijkl mnop") for readability only — the real credential has no spaces.
      // Pasting it verbatim into SMTP_PASS is a very common cause of "535
      // Username and Password not accepted" auth failures, so strip
      // whitespace defensively before authenticating.
      const cleanedPass = smtpPass.replace(/\s+/g, '');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: cleanedPass },
        // Force IPv4. Many cloud hosts (Render included) have broken or
        // entirely absent outbound IPv6 routing, but still hand back an
        // IPv6 address for smtp.gmail.com — Node tries that first, the
        // packets go nowhere (no ICMP unreachable, no active refusal, just
        // silence), and the connection sits until it finally times out.
        // That matches this deployment's actual observed failure mode
        // exactly ("Connection timeout", not "ECONNREFUSED" — a real block
        // or auth rejection would fail fast, not hang for 2 minutes).
        // Forcing IPv4 skips the broken path entirely if this is the cause.
        family: 4,
        // Nodemailer's defaults (connectionTimeout up to 2 minutes) assume a
        // network that can actually reach the SMTP host. Cloud platforms
        // (Render included) commonly block or heavily throttle outbound SMTP
        // as a standard anti-spam measure — without a short timeout here,
        // that shows up as the ENTIRE request (tenancy signup, onboarding
        // approval, etc.) hanging for up to 2 minutes before ever falling
        // through to the simulation fallback below, which callers/users
        // read as "stuck forever", not as an email problem.
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
      } as any); // nodemailer's TS overloads don't include `family`; a plain object literal here fails overload resolution
      await transporter.sendMail({
        from: `"Smart Teams" <${smtpFrom}>`,
        to, subject, text, html,
        attachments: attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      console.log(`[SMTP SUCCESS] Email sent to ${to}`);
      return { delivered: true, provider: 'smtp' };
    } catch (err: any) {
      console.error(`[SMTP ERROR]`, err?.message || err);
      if (err?.responseCode === 535 || /invalid login|username and password not accepted/i.test(err?.message || '')) {
        console.error(
          '[SMTP HINT] Gmail rejected the credentials. Checklist:\n' +
          '  1. SMTP_USER must be the full Gmail address the App Password belongs to.\n' +
          '  2. SMTP_PASS must be a 16-character App Password (Google Account > Security > App Passwords), NOT your normal Gmail password — Gmail requires 2-Step Verification to be enabled before App Passwords are available.\n' +
          '  3. SMTP_FROM should match SMTP_USER unless you have configured a verified "Send As" alias in Gmail.'
        );
      }
    }
  }

  // --- OPTION 3: Simulation fallback ---
  console.log(`[EMAIL SIMULATED] No mail provider configured. Check emails/ folder.`);
  return { delivered: false, provider: 'simulated' };
}

// --- Premium HTML Email Templates ---

const emailStyles = `
  margin: 0; padding: 0; font-family: 'Outfit', 'Inter', -apple-system, sans-serif; background-color: #F8FAFC; color: #1E293B;
`;

const containerStyles = `
  max-width: 600px; margin: 40px auto; padding: 40px; background-color: #FFFFFF; border-radius: 24px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.04); border: 1px border #E2E8F0;
`;

const headerStyles = `
  font-size: 24px; font-weight: 800; color: #0F172A; letter-spacing: -0.02em; margin-bottom: 24px;
`;

const cardStyles = `
  background-color: #F1F5F9; border-radius: 16px; padding: 24px; margin: 24px 0; border: 1px solid #E2E8F0;
`;

const buttonStyles = `
  display: inline-block; background-color: #7B5CFA; color: #FFFFFF; font-weight: 700; padding: 14px 28px; border-radius: 9999px; text-decoration: none; font-size: 14px; letter-spacing: 0.05em; text-transform: uppercase; margin-top: 16px; box-shadow: 0 4px 14px rgba(123, 92, 250, 0.3);
`;

const footerStyles = `
  font-size: 12px; color: #94A3B8; text-align: center; margin-top: 40px; border-top: 1px solid #E2E8F0; padding-top: 24px;
`;

export async function sendPasswordResetEmail(to: string, name: string, resetLink: string) {
  const subject = "Password Reset Request - Smart Teams";
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}">Reset Your Password</h2>
        <p>Hello ${name},</p>
        <p>We received a request to reset your password for your Smart Teams account. Click the button below to secure your account and set a new password:</p>
        <div style="text-align: center;">
          <a href="${resetLink}" style="${buttonStyles}">Reset Password</a>
        </div>
        <p style="margin-top: 24px; font-size: 13px; color: #64748B;">If you didn't request this, you can safely ignore this email. The link will expire in 24 hours.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${name},\n\nWe received a request to reset your password for your Smart Teams account. Reset it here: ${resetLink}\n\nIf you did not request this, ignore this email.`;
  await sendEmail({ to, subject, text, html });
}

export async function sendAttendanceCorrectionEmail(to: string, name: string, date: string, status: string, comment: string) {
  const subject = `Attendance Correction Update: ${status.toUpperCase()}`;
  const accentColor = status.toLowerCase() === 'approved' ? '#10B981' : '#EF4444';
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}">Attendance Correction Review</h2>
        <p>Hello ${name},</p>
        <p>Your manager has reviewed your attendance correction request for <strong>${date}</strong>.</p>
        <div style="${cardStyles}">
          <p style="margin: 0; font-size: 14px; font-weight: bold; color: ${accentColor}; uppercase tracking-wider;">
            Status: ${status.toUpperCase()}
          </p>
          ${comment ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;"><strong>Manager Comment:</strong> ${comment}</p>` : ''}
        </div>
        <p>If you have any questions, please contact your workspace administrator.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${name},\n\nYour attendance correction request for ${date} has been ${status.toUpperCase()}.\n\nManager comment: ${comment || 'None'}`;
  await sendEmail({ to, subject, text, html });
}

export async function sendBreakViolationAlert(to: string, name: string, date: string, breakDuration: number, allowedDuration: number) {
  const subject = "⚠️ Policy Alert: Break Limit Exceeded";
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #EF4444;">⚠️ Break Limit Exceeded</h2>
        <p>Hello ${name},</p>
        <p>Our real-time security logs indicate that your break duration on <strong>${date}</strong> exceeded the company policy limits.</p>
        <div style="${cardStyles}">
          <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Allowed Break:</strong> ${allowedDuration} minutes</p>
          <p style="margin: 0; font-size: 13px; color: #EF4444; font-weight: bold;"><strong>Your Break Duration:</strong> ${breakDuration} minutes</p>
        </div>
        <p style="font-size: 13px; color: #475569;">Please note that excessive break violations are logged in the audit ledger and escalated to management.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${name},\n\n⚠️ Policy Alert: Your break duration of ${breakDuration} minutes exceeded the company policy limit of ${allowedDuration} minutes on ${date}.`;
  await sendEmail({ to, subject, text, html });
}

// Sent to whoever holds 'attendance.approve' when an employee checks in late
// and submits an explanation — the check-in is recorded as 'pending' until
// one of these reviewers approves or rejects it.
export async function sendLateArrivalApprovalRequestEmail(to: string, approverName: string, employeeName: string, date: string, checkInTime: string, shiftStartTime: string, explanation: string) {
  const subject = `⏰ Approval Needed: Late Check-In by ${employeeName}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #F59E0B;">⏰ Late Check-In Awaiting Approval</h2>
        <p>Hello ${approverName},</p>
        <p><strong>${employeeName}</strong> checked in late on <strong>${date}</strong> and needs your approval before it's finalized.</p>
        <div style="${cardStyles}">
          <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Shift Start Time:</strong> ${shiftStartTime}</p>
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #F59E0B; font-weight: bold;"><strong>Clock-In Time:</strong> ${checkInTime}</p>
          <p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;"><strong>Employee's Explanation:</strong> ${explanation}</p>
        </div>
        <p style="font-size: 13px; color: #475569;">Please review and Approve or Reject this check-in from your dashboard. If rejected, the day will be marked absent.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${approverName},\n\n${employeeName} checked in late (at ${checkInTime}, shift starts ${shiftStartTime}) on ${date} and needs approval.\n\nExplanation: ${explanation}\n\nPlease review from your dashboard.`;
  await sendEmail({ to, subject, text, html });
}

// Sent to the employee once a manager/admin has approved or rejected their
// pending late check-in.
export async function sendLateArrivalDecisionEmail(to: string, name: string, date: string, status: 'approved' | 'rejected') {
  const subject = `Late Check-In ${status.toUpperCase()}: ${date}`;
  const accentColor = status === 'approved' ? '#10B981' : '#EF4444';
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}">Late Check-In Reviewed</h2>
        <p>Hello ${name},</p>
        <p>Your manager has reviewed your late check-in on <strong>${date}</strong>.</p>
        <div style="${cardStyles}">
          <p style="margin: 0; font-size: 14px; font-weight: bold; color: ${accentColor}; uppercase tracking-wider;">
            Status: ${status.toUpperCase()}
          </p>
          ${status === 'rejected' ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;">This day has been marked as absent. If you believe this is a mistake, please submit an attendance correction request.</p>` : ''}
        </div>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${name},\n\nYour late check-in on ${date} has been ${status.toUpperCase()}.${status === 'rejected' ? ' This day has been marked as absent.' : ''}`;
  await sendEmail({ to, subject, text, html });
}

export async function sendManagerEscalationEmail(to: string, managerName: string, employeeName: string, violationType: string, details: string) {
  const subject = `🚨 Security Escalation: Policy Breach by ${employeeName}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #EF4444;">🚨 Policy Violation Escalation</h2>
        <p>Hello ${managerName},</p>
        <p>This is an automated escalation from the Smart Teams Security Engine. A policy breach has been detected for <strong>${employeeName}</strong>.</p>
        <div style="${cardStyles}">
          <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: bold; color: #EF4444; text-transform: uppercase;">
            Breach: ${violationType}
          </p>
          <p style="margin: 12px 0 0 0; font-size: 13px; color: #334155;"><strong>Event Details:</strong> ${details}</p>
        </div>
        <p style="font-size: 13px; color: #475569;">This event has been recorded as an immutable block in the cryptographic audit ledger.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${managerName},\n\n🚨 Security Escalation: A policy breach (${violationType}) has been logged for ${employeeName}.\n\nDetails: ${details}`;
  await sendEmail({ to, subject, text, html });
}

// Sent both to the person whose attendance dropped below the tenant's
// configured minimum, and up the role hierarchy (see
// getHierarchyAlertRecipients in server.ts) — isSelf controls the wording.
export async function sendLowAttendanceAlertEmail(to: string, recipientName: string, subjectName: string, subjectRole: string, percentage: number, threshold: number, isSelf: boolean) {
  const subject = isSelf
    ? `⚠️ Your Attendance Is Below the Required Minimum`
    : `⚠️ Attendance Alert: ${subjectName} Is Below the Required Minimum`;
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #F59E0B;">⚠️ Attendance Below Minimum</h2>
        <p>Hello ${recipientName},</p>
        <p>${isSelf
          ? `Your attendance percentage for this month has dropped below your organization's required minimum.`
          : `<strong>${subjectName}</strong> (${subjectRole}) has an attendance percentage below your organization's required minimum this month.`}</p>
        <div style="${cardStyles}">
          <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Required Minimum:</strong> ${threshold}%</p>
          <p style="margin: 0; font-size: 13px; color: #F59E0B; font-weight: bold;"><strong>Current Attendance:</strong> ${percentage}%</p>
        </div>
        <p style="font-size: 13px; color: #475569;">${isSelf ? 'If you believe this is a mistake, please submit an attendance correction request.' : 'This has also been logged as an alert in your dashboard.'}</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = isSelf
    ? `Hello ${recipientName},\n\nYour attendance this month is ${percentage}%, below the required minimum of ${threshold}%.`
    : `Hello ${recipientName},\n\n${subjectName} (${subjectRole}) has an attendance of ${percentage}% this month, below the required minimum of ${threshold}%.`;
  await sendEmail({ to, subject, text, html });
}

// Sent when an employee tries to end a break outside the office geofence —
// the break stays active server-side; this just notifies the employee and
// the same role hierarchy as the low-attendance alert above.
export async function sendBreakLocationViolationEmail(to: string, recipientName: string, subjectName: string, isSelf: boolean) {
  const subject = isSelf
    ? `⚠️ Could Not End Break: Outside Office Location`
    : `⚠️ Break Location Alert: ${subjectName}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #EF4444;">⚠️ Break Location Violation</h2>
        <p>Hello ${recipientName},</p>
        <p>${isSelf
          ? `We couldn't end your break because your location doesn't match the office. Your break remains active until you're back within range.`
          : `<strong>${subjectName}</strong> tried to end a break from outside the office location. Their break remains active until they're back within range.`}</p>
        <p style="font-size: 13px; color: #475569;">This event has been recorded in the audit ledger.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = isSelf
    ? `Hello ${recipientName},\n\nWe couldn't end your break — your location doesn't match the office. Your break remains active until you're back in range.`
    : `Hello ${recipientName},\n\n${subjectName} tried to end a break from outside the office location. Their break remains active.`;
  await sendEmail({ to, subject, text, html });
}

// --- Work From Home (WFH) email templates ---
// Follow the exact same recipe as the late-arrival approval pair above:
// a request email to whoever can act on it, and a decision email back to
// the employee once resolved.

export async function sendWfhApprovalRequestEmail(to: string, approverName: string, employeeName: string, date: string, reason: string, distanceMeters: number) {
  const subject = `🏠 Approval Needed: Work From Home — ${employeeName}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #7B5CFA;">🏠 Work From Home Awaiting Approval</h2>
        <p>Hello ${approverName},</p>
        <p><strong>${employeeName}</strong> checked in as Work From Home on <strong>${date}</strong> and needs your approval.</p>
        <div style="${cardStyles}">
          <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Distance from registered home:</strong> ${Math.round(distanceMeters)}m</p>
          ${reason ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;"><strong>Reason:</strong> ${reason}</p>` : ''}
        </div>
        <p style="font-size: 13px; color: #475569;">Please review and Approve or Reject this check-in from your dashboard.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${approverName},\n\n${employeeName} checked in as Work From Home on ${date} and needs approval.\n\nDistance from registered home: ${Math.round(distanceMeters)}m\nReason: ${reason || 'None provided'}\n\nPlease review from your dashboard.`;
  await sendEmail({ to, subject, text, html });
}

export async function sendWfhDecisionEmail(to: string, name: string, date: string, status: 'approved' | 'rejected') {
  const subject = `Work From Home ${status.toUpperCase()}: ${date}`;
  const accentColor = status === 'approved' ? '#10B981' : '#EF4444';
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}">Work From Home Reviewed</h2>
        <p>Hello ${name},</p>
        <p>Your Work From Home attendance for <strong>${date}</strong> has been reviewed.</p>
        <div style="${cardStyles}">
          <p style="margin: 0; font-size: 14px; font-weight: bold; color: ${accentColor}; uppercase tracking-wider;">
            Status: ${status.toUpperCase()}
          </p>
          ${status === 'rejected' ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;">This day has been marked as absent. If you believe this is a mistake, please submit an attendance correction request.</p>` : ''}
        </div>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${name},\n\nYour Work From Home attendance on ${date} has been ${status.toUpperCase()}.${status === 'rejected' ? ' This day has been marked as absent.' : ''}`;
  await sendEmail({ to, subject, text, html });
}

// Sent to whoever holds 'attendance.approve' when an employee requests a
// change to their registered WFH home location.
export async function sendWfhLocationChangeRequestEmail(to: string, approverName: string, employeeName: string, newAddress: string, reason: string) {
  const subject = `📍 Approval Needed: Home Location Change — ${employeeName}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #7B5CFA;">📍 Home Location Change Requested</h2>
        <p>Hello ${approverName},</p>
        <p><strong>${employeeName}</strong> has requested to change their registered Work From Home location.</p>
        <div style="${cardStyles}">
          ${newAddress ? `<p style="margin: 0 0 8px 0; font-size: 13px;"><strong>New Location:</strong> ${newAddress}</p>` : ''}
          ${reason ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;"><strong>Reason:</strong> ${reason}</p>` : ''}
        </div>
        <p style="font-size: 13px; color: #475569;">Please review and Approve or Reject this request from your dashboard.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${approverName},\n\n${employeeName} has requested to change their registered Work From Home location.\n\n${newAddress ? `New Location: ${newAddress}\n` : ''}Reason: ${reason || 'None provided'}\n\nPlease review from your dashboard.`;
  await sendEmail({ to, subject, text, html });
}

export async function sendWfhLocationChangeDecisionEmail(to: string, name: string, status: 'approved' | 'rejected') {
  const subject = `Home Location Change ${status.toUpperCase()}`;
  const accentColor = status === 'approved' ? '#10B981' : '#EF4444';
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}">Home Location Change Reviewed</h2>
        <p>Hello ${name},</p>
        <p>Your request to change your registered Work From Home location has been reviewed.</p>
        <div style="${cardStyles}">
          <p style="margin: 0; font-size: 14px; font-weight: bold; color: ${accentColor}; uppercase tracking-wider;">
            Status: ${status.toUpperCase()}
          </p>
        </div>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${name},\n\nYour Work From Home location change request has been ${status.toUpperCase()}.`;
  await sendEmail({ to, subject, text, html });
}

export async function sendLeaveApprovalRequestEmail(to: string, approverName: string, employeeName: string, leaveType: string, startDate: string, endDate: string, totalDays: number, reason: string) {
  const subject = `Leave Approval Needed: ${employeeName}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #0F766E;">Leave Request Awaiting Approval</h2>
        <p>Hello ${approverName},</p>
        <p><strong>${employeeName}</strong> submitted a leave request that needs review.</p>
        <div style="${cardStyles}">
          <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Type:</strong> ${leaveType}</p>
          <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Dates:</strong> ${startDate} to ${endDate}</p>
          <p style="margin: 0 0 8px 0; font-size: 13px;"><strong>Total Days:</strong> ${totalDays}</p>
          <p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;"><strong>Reason:</strong> ${reason}</p>
        </div>
        <p style="font-size: 13px; color: #475569;">Please approve or reject this leave request from the dashboard.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${approverName},\n\n${employeeName} submitted a ${leaveType} leave request from ${startDate} to ${endDate} for ${totalDays} day(s).\n\nReason: ${reason}\n\nPlease review it from the dashboard.`;
  await sendEmail({ to, subject, text, html });
}

export async function sendLeaveDecisionEmail(to: string, employeeName: string, leaveType: string, startDate: string, endDate: string, status: 'approved' | 'rejected', comment?: string) {
  const subject = `Leave Request ${status.toUpperCase()}: ${leaveType}`;
  // Calendar attachment only on approval — a rejected request has nothing
  // to put on a calendar. See services/ics.ts for why this is a plain
  // .ics attachment rather than live Google/Outlook sync.
  const attachments = status === 'approved'
    ? [{
        filename: 'leave.ics',
        contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
        content: buildLeaveIcs({
          uid: `leave-${employeeName.replace(/\s+/g, '')}-${startDate}-${endDate}@smartteams`,
          summary: `${leaveType} — ${employeeName}`,
          description: `Approved ${leaveType} leave for ${employeeName}.`,
          startDate,
          endDate,
        }),
      }]
    : undefined;
  const accentColor = status === 'approved' ? '#10B981' : '#EF4444';
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}">Leave Request Reviewed</h2>
        <p>Hello ${employeeName},</p>
        <p>Your <strong>${leaveType}</strong> leave request for <strong>${startDate}</strong> to <strong>${endDate}</strong> has been reviewed.</p>
        <div style="${cardStyles}">
          <p style="margin: 0; font-size: 14px; font-weight: bold; color: ${accentColor}; uppercase tracking-wider;">
            Status: ${status.toUpperCase()}
          </p>
          ${comment ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;"><strong>Reviewer Comment:</strong> ${comment}</p>` : ''}
        </div>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${employeeName},\n\nYour ${leaveType} leave request for ${startDate} to ${endDate} has been ${status.toUpperCase()}.${comment ? `\n\nReviewer comment: ${comment}` : ''}`;
  await sendEmail({ to, subject, text, html, attachments });
}

// --- Employee termination email templates ---
// Same request/decision pair pattern as WFH and late-arrival above. Sent
// only for the DELEGATED-privilege path (someone other than the tenant
// admin submitted a termination request) — the tenant admin's own
// immediate terminations don't go through this queue at all.

export async function sendTerminationRequestEmail(to: string, adminName: string, employeeName: string, requestedByName: string, reason: string) {
  const subject = `⚠️ Approval Needed: Termination Request — ${employeeName}`;
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}; color: #EF4444;">Termination Request Awaiting Approval</h2>
        <p>Hello ${adminName},</p>
        <p><strong>${requestedByName}</strong> has requested to terminate <strong>${employeeName}</strong>.</p>
        <div style="${cardStyles}">
          <p style="margin: 0; font-size: 13px; color: #475569;"><strong>Reason:</strong> ${reason}</p>
        </div>
        <p style="font-size: 13px; color: #475569;">This employee will not be removed until you Approve or Reject this request from your dashboard.</p>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${adminName},\n\n${requestedByName} has requested to terminate ${employeeName}.\n\nReason: ${reason}\n\nThis employee will not be removed until you Approve or Reject this request from your dashboard.`;
  await sendEmail({ to, subject, text, html });
}

export async function sendTerminationDecisionEmail(to: string, requestedByName: string, employeeName: string, status: 'approved' | 'rejected') {
  const subject = `Termination Request ${status.toUpperCase()}: ${employeeName}`;
  const accentColor = status === 'approved' ? '#10B981' : '#EF4444';
  const html = `
    <div style="${emailStyles}">
      <div style="${containerStyles}">
        <h2 style="${headerStyles}">Termination Request Reviewed</h2>
        <p>Hello ${requestedByName},</p>
        <p>Your request to terminate <strong>${employeeName}</strong> has been reviewed.</p>
        <div style="${cardStyles}">
          <p style="margin: 0; font-size: 14px; font-weight: bold; color: ${accentColor}; uppercase tracking-wider;">
            Status: ${status.toUpperCase()}
          </p>
          ${status === 'approved' ? `<p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;">${employeeName} has been removed from the organization.</p>` : `<p style="margin: 12px 0 0 0; font-size: 13px; color: #475569;">${employeeName} remains active — no changes were made.</p>`}
        </div>
        <div style="${footerStyles}">
          <p>© 2026 Smart Teams Security Engine. All rights reserved.</p>
        </div>
      </div>
    </div>
  `;
  const text = `Hello ${requestedByName},\n\nYour request to terminate ${employeeName} has been ${status.toUpperCase()}.`;
  await sendEmail({ to, subject, text, html });
}
