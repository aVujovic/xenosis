import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

// Sample table — replace with your schema.
export const example = pgTable('example', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Example = typeof example.$inferSelect;
export type NewExample = typeof example.$inferInsert;
