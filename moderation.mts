import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq } from 'drizzle-orm';
import { accountRecords } from '../../../db/schema.js';
export async function isBanned(id: string) {
  const [row] = await drizzle().select().from(accountRecords).where(and(eq(accountRecords.userId, id), eq(accountRecords.key, 'moderation:account')));
  return (row?.value as any)?.banned === true;
}
