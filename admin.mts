// Match the interface allowlist; use only the authenticated Identity email.
export const ADMIN_EMAILS = ['cerko11real@gmail.com'];
export function isAdminEmail(email: unknown): boolean {
  return typeof email === 'string' && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
