import { sqliteTable, integer, real, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ----------------- USERS -----------------
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  isAdmin: integer("is_admin").notNull().default(0), // 0=false, 1=true
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`), // store as epoch ms
});

// ----------------- SLOTS -----------------
export const slots = sqliteTable("slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  playerIndex: integer("player_index").notNull(),
  balance: integer("balance").notNull().default(0), // cents
});

// ----------------- ROUNDS -----------------
export const rounds = sqliteTable("rounds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  crashPoint: real("crash_point").notNull(),
  serverSeed: text("server_seed").notNull(),
  clientSeed: text("client_seed").notNull(),
  nonce: integer("nonce").notNull(),
  status: text("status").notNull().default("pending"),
  startTime: integer("start_time").notNull().default(0), // epoch ms
  endTime: integer("end_time").notNull().default(0),
});

// ----------------- BETS -----------------
export const bets = sqliteTable("bets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  playerIndex: integer("player_index").notNull().default(0),
  roundId: integer("round_id").notNull(),
  amount: integer("amount").notNull(),
  cashoutMultiplier: real("cashout_multiplier"),
  autoCashout: real("auto_cashout"),
  winAmount: integer("win_amount"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

// ----------------- ZOD SCHEMAS -----------------
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertAdminUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  isAdmin: true,
});

export const insertBetSchema = createInsertSchema(bets)
  .pick({
    amount: true,
    autoCashout: true,
    playerIndex: true,
  })
  .extend({
    amount: z.number().min(1),
    autoCashout: z.number().min(1.01).optional().nullable(),
    playerIndex: z.number().min(0).max(4).optional().default(0),
  });

// ----------------- TYPES -----------------
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Round = typeof rounds.$inferSelect;
export type Bet = typeof bets.$inferSelect;
export type InsertBet = z.infer<typeof insertBetSchema>;
