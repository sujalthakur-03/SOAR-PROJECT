/**
 * JWT Token Utilities for CyberSentinel SOAR
 *
 * Provides token expiry checking without external dependencies.
 * Uses atob() to decode the JWT payload (base64url).
 */

const AUTH_TOKEN_KEY = 'cybersentinel_auth_token';

/** Threshold in seconds before expiry to show a warning toast */
export const EXPIRY_WARNING_SECONDS = 5 * 60; // 5 minutes

interface JWTPayload {
  exp?: number;  // Expiry time (Unix timestamp in seconds)
  iat?: number;  // Issued-at time
  sub?: string;  // Subject (user ID)
  [key: string]: unknown;
}

/**
 * Decode a JWT payload without verifying the signature.
 * Returns null if the token is malformed.
 */
export function decodeJWTPayload(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // JWT uses base64url encoding: replace - with +, _ with /
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }

    const jsonStr = atob(base64);
    return JSON.parse(jsonStr) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Get the number of seconds until the stored JWT expires.
 * Returns null if no token or token has no exp claim.
 * Returns a negative number if already expired.
 */
export function getSecondsUntilExpiry(token?: string | null): number | null {
  const t = token ?? (typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null);
  if (!t) return null;

  const payload = decodeJWTPayload(t);
  if (!payload?.exp) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  return payload.exp - nowSeconds;
}

/**
 * Check whether the stored JWT is expired.
 */
export function isTokenExpired(token?: string | null): boolean {
  const remaining = getSecondsUntilExpiry(token);
  if (remaining === null) return false; // No exp claim, assume valid
  return remaining <= 0;
}

/**
 * Check whether the stored JWT is about to expire (within threshold).
 */
export function isTokenExpiringSoon(token?: string | null, thresholdSeconds: number = EXPIRY_WARNING_SECONDS): boolean {
  const remaining = getSecondsUntilExpiry(token);
  if (remaining === null) return false;
  return remaining > 0 && remaining <= thresholdSeconds;
}
