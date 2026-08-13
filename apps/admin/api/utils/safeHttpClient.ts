import dns from 'dns';
import net from 'net';
import { URL } from 'url';

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxSizeBytes?: number;
  allowedContentTypes?: string[];
  allowHttpForLocalhost?: boolean;
}

/**
 * Checks whether an IP address (IPv4 or IPv6) belongs to a private,
 * loopback, link-local, carrier-grade NAT, or cloud metadata address space.
 */
export function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return true;

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [p0, p1] = parts;

    // 0.0.0.0/8 - Current network
    if (p0 === 0) return true;

    // 10.0.0.0/8 - Private network
    if (p0 === 10) return true;

    // 100.64.0.0/10 - Carrier-grade NAT
    if (p0 === 100 && p1 >= 64 && p1 <= 127) return true;

    // 127.0.0.0/8 - Loopback
    if (p0 === 127) return true;

    // 169.254.0.0/16 - Link-local / AWS / GCP / Azure Instance Metadata
    if (p0 === 169 && p1 === 254) return true;

    // 172.16.0.0/12 - Private network
    if (p0 === 172 && p1 >= 16 && p1 <= 31) return true;

    // 192.168.0.0/16 - Private network
    if (p0 === 192 && p1 === 168) return true;

    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 - Documentation
    if (p0 === 192 && p1 === 0 && parts[2] === 2) return true;
    if (p0 === 198 && p1 === 51 && parts[2] === 100) return true;
    if (p0 === 203 && p1 === 0 && parts[2] === 113) return true;

    // 224.0.0.0/4 - Multicast
    if (p0 >= 224 && p0 <= 239) return true;

    // 240.0.0.0/4 - Reserved
    if (p0 >= 240) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Loopback / Unspecified
    if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') return true;

    // Unique Local Address (fc00::/7)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

    // Link-Local Address (fe80::/10)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

    // IPv4-mapped IPv6 address (::ffff:127.0.0.1 etc.)
    if (lower.startsWith('::ffff:')) {
      const ipv4Part = lower.substring(7);
      if (net.isIPv4(ipv4Part)) {
        return isPrivateIp(ipv4Part);
      }
    }
  }

  return false;
}

/**
 * Resolves a hostname to IP addresses via DNS lookup and verifies
 * that none of the target addresses resolve to private/internal networks.
 */
export async function validateTargetUrl(rawUrl: string, options?: SafeFetchOptions): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF Validation Failed: Invalid URL string '${rawUrl}'`);
  }

  const protocol = parsed.protocol.toLowerCase();
  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  if (protocol !== 'https:') {
    if (protocol === 'http:' && options?.allowHttpForLocalhost && isLocalhost) {
      // Allowed explicitly for dev localhost tests
    } else {
      throw new Error(`SSRF Validation Failed: Disallowed protocol '${protocol}'. Only HTTPS URLs are permitted.`);
    }
  }

  // Resolve hostname via DNS
  if (net.isIP(parsed.hostname)) {
    if (isPrivateIp(parsed.hostname)) {
      throw new Error(`SSRF Validation Failed: Target IP '${parsed.hostname}' is a private or reserved network address.`);
    }
  } else {
    try {
      const addresses = await dns.promises.lookup(parsed.hostname, { all: true });
      for (const addr of addresses) {
        if (isPrivateIp(addr.address)) {
          throw new Error(`SSRF Validation Failed: Domain '${parsed.hostname}' resolves to private/internal IP address '${addr.address}'.`);
        }
      }
    } catch (dnsErr: any) {
      if (dnsErr?.message?.includes('SSRF Validation Failed')) throw dnsErr;
      throw new Error(`SSRF Validation Failed: Could not resolve hostname '${parsed.hostname}'.`);
    }
  }

  return parsed;
}

/**
 * Safe fetch wrapper that enforces SSRF checks, DNS lookup validation,
 * execution timeouts, content-type checks, and body size limits.
 */
export async function safeFetchBuffer(rawUrl: string, options?: SafeFetchOptions): Promise<{ buffer: Buffer; contentType: string }> {
  const targetUrl = await validateTargetUrl(rawUrl, options);
  const timeoutMs = options?.timeoutMs || 5000;
  const maxSizeBytes = options?.maxSizeBytes || 2 * 1024 * 1024; // 2MB default limit

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(targetUrl.toString(), {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual', // Do not automatically follow unvalidated redirects
      headers: {
        'User-Agent': 'SmartTeams-SafeFetch/1.0',
      },
    });

    if (!res.ok) {
      throw new Error(`SafeFetch HTTP Error: Server responded with status ${res.status}`);
    }

    // Check redirect status
    if ([301, 302, 307, 308].includes(res.status)) {
      const redirectLocation = res.headers.get('location');
      if (!redirectLocation) throw new Error('SafeFetch Error: Redirect missing location header');
      // Recursively validate redirect destination
      return safeFetchBuffer(new URL(redirectLocation, targetUrl).toString(), options);
    }

    const contentType = res.headers.get('content-type') || '';
    if (options?.allowedContentTypes && options.allowedContentTypes.length > 0) {
      const isAllowed = options.allowedContentTypes.some(t => contentType.toLowerCase().includes(t.toLowerCase()));
      if (!isAllowed) {
        throw new Error(`SafeFetch Error: Disallowed Content-Type '${contentType}'`);
      }
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxSizeBytes) {
      throw new Error(`SafeFetch Error: Content length ${contentLength} bytes exceeds limit of ${maxSizeBytes} bytes`);
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > maxSizeBytes) {
      throw new Error(`SafeFetch Error: Downloaded payload ${arrayBuf.byteLength} bytes exceeds limit of ${maxSizeBytes} bytes`);
    }

    return {
      buffer: Buffer.from(arrayBuf),
      contentType,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`SafeFetch Error: Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
