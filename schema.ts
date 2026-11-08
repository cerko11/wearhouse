import { pgTable, text, jsonb, primaryKey, timestamp } from 'drizzle-orm/pg-core';

export const accountRecords = pgTable('account_records', {
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, table => [primaryKey({ columns: [table.userId, table.key] })]);
