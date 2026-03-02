import { users, rounds, bets, slots, type User, type InsertUser, type Bet, type InsertBet, type Round } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

type AdminUserInsert = { username: string; password: string; isAdmin: number };

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createAdminUser(user: AdminUserInsert): Promise<User>;
  updateUserBalance(id: number, balance: number): Promise<User>;
  getAllUsers(): Promise<User[]>;
  createAdminIfNotExists(passwordHash: string): Promise<void>;
  
  // Slot operations
  getSlot(userId: number, playerIndex: number): Promise<{ id: number; userId: number; playerIndex: number; balance: number } | undefined>;
  ensureSlots(userId: number): Promise<void>;
  updateSlotBalance(userId: number, playerIndex: number, balance: number): Promise<void>;
  getUserSlots(userId: number): Promise<{ id: number; userId: number; playerIndex: number; balance: number }[]>;
  updateRoundStatus(id: number, status: string, endTime?: Date): Promise<Round>;
  getRecentRounds(limit?: number): Promise<Round[]>;
  
  createBet(bet: InsertBet & { userId: number, roundId: number, playerIndex: number }): Promise<Bet>;
  updateBetStatus(id: number, status: string, cashoutMultiplier?: number, winAmount?: number): Promise<Bet>;
  getActiveBets(roundId: number): Promise<(Bet & { user: Omit<User, 'password'> })[]>;
  getUserActiveBets(userId: number, roundId: number): Promise<Bet[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createAdminUser(adminUser: AdminUserInsert): Promise<User> {
    const [user] = await db.insert(users).values(adminUser).returning();
    return user;
  }

  async updateUserBalance(id: number, _balance: number): Promise<User> {
    const [user] = await db.select().from(users).where(eq(users.id, id)).then(r => r);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getSlot(userId: number, playerIndex: number) {
    const [slot] = await db.select().from(slots).where(and(eq(slots.userId, userId), eq(slots.playerIndex, playerIndex)));
    return slot;
  }

  async ensureSlots(userId: number) {
    const existing = await db.select().from(slots).where(eq(slots.userId, userId));
    if (existing.length < 5) {
      const needed = [0, 1, 2, 3, 4].filter(i => !existing.some(s => s.playerIndex === i));
      for (const playerIndex of needed) {
        await db.insert(slots).values({ userId, playerIndex, balance: 0 });
      }
    }
  }

  async updateSlotBalance(userId: number, playerIndex: number, balance: number) {
    await db.update(slots).set({ balance }).where(and(eq(slots.userId, userId), eq(slots.playerIndex, playerIndex)));
  }

  async getUserSlots(userId: number) {
    return await db.select().from(slots).where(eq(slots.userId, userId)).orderBy(slots.playerIndex);
  }

  async createAdminIfNotExists(passwordHash: string): Promise<void> {
    const [existingAdmin] = await db.select().from(users).where(eq(users.username, 'admin'));
    if (!existingAdmin) {
      await db.insert(users).values({
        username: 'admin',
        password: passwordHash,
        isAdmin: 1
      });
    }
  }

  async createRound(crashPoint: number, serverSeed: string, clientSeed: string, nonce: number): Promise<Round> {
    const [round] = await db.insert(rounds).values({
      crashPoint,
      serverSeed,
      clientSeed,
      nonce,
      status: 'pending',
    }).returning();
    return round;
  }

  async updateRoundStatus(id: number, status: string, endTime?: Date): Promise<Round> {
    const endTimeMs = endTime ? endTime.getTime() : undefined;
    const [round] = await db.update(rounds).set({ status, endTime: endTimeMs }).where(eq(rounds.id, id)).returning();
    return round;
  }

  async getRecentRounds(limit = 20): Promise<Round[]> {
    return await db.select().from(rounds).where(eq(rounds.status, 'crashed')).orderBy(desc(rounds.id)).limit(limit);
  }

  async createBet(bet: any): Promise<Bet> {
    const [newBet] = await db.insert(bets).values({
      userId: bet.userId,
      roundId: bet.roundId,
      amount: bet.amount,
      autoCashout: bet.autoCashout,
      playerIndex: bet.playerIndex ?? 0,
      status: 'active'
    }).returning();
    return newBet;
  }

  async updateBetStatus(id: number, status: string, cashoutMultiplier?: number, winAmount?: number): Promise<Bet> {
    const [bet] = await db.update(bets).set({ status, cashoutMultiplier, winAmount }).where(eq(bets.id, id)).returning();
    return bet;
  }

  async getActiveBets(roundId: number): Promise<(Bet & { user: Omit<User, 'password'> })[]> {
    const activeBets = await db.select({
      bet: bets,
      user: users
    }).from(bets)
      .innerJoin(users, eq(bets.userId, users.id))
      .where(eq(bets.roundId, roundId));
      
    return activeBets.map(r => {
      const { password, ...userWithoutPassword } = r.user;
      return { ...r.bet, user: userWithoutPassword };
    });
  }

  async getUserActiveBets(userId: number, roundId: number): Promise<Bet[]> {
    return await db.select().from(bets).where(and(eq(bets.userId, userId), eq(bets.roundId, roundId)));
  }
}

export const storage = new DatabaseStorage();