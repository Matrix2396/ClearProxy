import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const historyTable = pgTable("history", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title"),
  favicon: text("favicon"),
  visitedAt: timestamp("visited_at").defaultNow().notNull(),
});

export const insertHistorySchema = createInsertSchema(historyTable).omit({ id: true, visitedAt: true });
export type InsertHistory = z.infer<typeof insertHistorySchema>;
export type HistoryEntry = typeof historyTable.$inferSelect;
