import { WebSocket, WebSocketServer } from "ws";
import { Server } from "http";
import { storage } from "./storage";
import { wsEvents } from "@shared/routes";
import crypto from "crypto";

interface Client extends WebSocket {
  userId?: number;
  username?: string;
  isAlive: boolean;
}

interface NextBet {
  amount: number;
  autoCashout?: number | null;
}

export class GameEngine {
  private wss: WebSocketServer;
  private status: "betting" | "active" | "crashed" = "crashed";
  private currentRoundId: number | null = null;
  private crashPoint = 1.0;
  private multiplier = 1.0;
  private startTime = 0;

  private growthRate = 0.06;
  private gameLoop: NodeJS.Timeout | null = null;
  private stateBroadcastInterval: NodeJS.Timeout | null = null;
  private bettingTimeout: NodeJS.Timeout | null = null;

  private serverSeed = "";
  private clientSeed = "00000000000000000000000000000000"; // Default daily hash
  private nonce = 0;

  // Store "Bet Next" per user & slot
  private nextBets: Record<number, Record<number, NextBet>> = {};

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.setupWebSocket();
    this.startNewRound();
  }

  // ---------------------------
  // WebSocket & heartbeat
  // ---------------------------
  private setupWebSocket() {
    this.wss.on("connection", (ws: Client) => {
      ws.isAlive = true;
      ws.on("pong", () => (ws.isAlive = true));

      ws.on("message", (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === "auth" && data.userId) {
            ws.userId = data.userId;
            ws.username = data.username;
          }
        } catch {}
      });

      // Send initial state
      ws.send(
        JSON.stringify({
          type: wsEvents.SERVER_STATE_UPDATE,
          payload: this.getStatus(),
        }),
      );
    });

    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = ws as Client;
        if (!client.isAlive) return client.terminate();
        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    this.wss.on("close", () => clearInterval(interval));
  }

  // ---------------------------
  // Broadcast helpers
  // ---------------------------
  private broadcast(type: string, payload: any) {
    const msg = JSON.stringify({ type, payload });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }

  private sendToUser(userId: number, type: string, payload: any) {
    const msg = JSON.stringify({ type, payload });
    this.wss.clients.forEach((client) => {
      const c = client as Client;
      if (c.readyState === WebSocket.OPEN && c.userId === userId) c.send(msg);
    });
  }

  // ---------------------------
  // Crash calculation
  // ---------------------------
  private generateCrashPoint() {
    this.serverSeed = crypto.randomBytes(32).toString("hex");
    this.nonce++;

    const hmac = crypto.createHmac("sha256", this.serverSeed);
    hmac.update(`${this.clientSeed}:${this.nonce}`);
    const hash = hmac.digest("hex");

    const h = parseInt(hash.slice(0, 13), 16);
    const e = Math.pow(2, 52);
    const result = h / e;

    return Math.max(1.0, Math.floor(90 / (1 - result)) / 100);
  }

  // ---------------------------
  // Round lifecycle
  // ---------------------------
  private async startNewRound() {
    try {
      this.clearTimers();

      this.status = "betting";
      this.multiplier = 1.0;
      this.crashPoint = this.generateCrashPoint();

      const round = await storage.createRound(
        this.crashPoint,
        this.serverSeed,
        this.clientSeed,
        this.nonce,
      );
      this.currentRoundId = round.id;

      this.broadcast(wsEvents.SERVER_ROUND_START, {
        roundId: this.currentRoundId,
      });
      this.broadcastState();

      // Betting phase 5s
      this.bettingTimeout = setTimeout(() => this.startGame(), 5000);
    } catch (e) {
      console.error("Failed to start new round:", e);
      setTimeout(() => this.startNewRound(), 2000);
    }
  }

  private async startGame() {
    if (this.status !== "betting") return;
    this.status = "active";
    this.startTime = Date.now();

    if (this.currentRoundId)
      await storage.updateRoundStatus(this.currentRoundId, "active");

    // Game tick
    this.gameLoop = setInterval(() => this.tick(), 50);
    this.stateBroadcastInterval = setInterval(() => this.broadcastState(), 100);

    // Auto-place "Bet Next" bets
    for (const userIdStr in this.nextBets) {
      const userId = Number(userIdStr);
      for (const slotStr in this.nextBets[userId]) {
        const slot = Number(slotStr);
        const bet = this.nextBets[userId][slot];
        this.placeBet(userId, slot, bet.amount, bet.autoCashout, false);
      }
    }
    this.nextBets = {};
  }

  private clearTimers() {
    if (this.gameLoop) clearInterval(this.gameLoop);
    if (this.stateBroadcastInterval) clearInterval(this.stateBroadcastInterval);
    if (this.bettingTimeout) clearTimeout(this.bettingTimeout);
    this.gameLoop = null;
    this.stateBroadcastInterval = null;
    this.bettingTimeout = null;
  }

  // ---------------------------
  // Tick logic (multiplier & auto cashout)
  // ---------------------------
  private async tick() {
    if (this.status !== "active") return;

    const elapsed = Date.now() - this.startTime;
    this.multiplier = Math.pow(Math.E, this.growthRate * (elapsed / 1000));

    if (this.multiplier >= this.crashPoint) {
      this.multiplier = this.crashPoint;
      await this.crash();
      return;
    }

    if (!this.currentRoundId) return;
    const activeBets = await storage.getActiveBets(this.currentRoundId);
    await Promise.all(
      activeBets.map(async (bet) => {
        if (
          bet.status === "active" &&
          bet.autoCashout &&
          this.multiplier >= bet.autoCashout &&
          this.multiplier < this.crashPoint
        ) {
          await this.handleCashout(
            bet.userId,
            bet.autoCashout,
            bet.playerIndex,
          );
        }
      }),
    );
  }

  // ---------------------------
  // Crash
  // ---------------------------
  private async crash() {
    this.status = "crashed";
    this.clearTimers();

    if (this.currentRoundId) {
      await storage.updateRoundStatus(
        this.currentRoundId,
        "crashed",
        new Date(),
      );
      const activeBets = await storage.getActiveBets(this.currentRoundId);
      await Promise.all(
        activeBets
          .filter((b) => b.status === "active")
          .map((b) => storage.updateBetStatus(b.id, "lost")),
      );
    }

    this.broadcast(wsEvents.SERVER_ROUND_CRASH, {
      crashPoint: this.crashPoint,
    });
    this.broadcastState();

    setTimeout(() => this.startNewRound(), 3000);
  }

  // ---------------------------
  // Place Bet
  // ---------------------------
  public async placeBet(
    userId: number,
    playerIndex: number,
    amount: number,
    autoCashout?: number | null,
    saveNextBet: boolean = false,
  ) {
    if (this.status !== "betting" && !saveNextBet)
      throw new Error("Cannot bet now");
    if (!this.currentRoundId) throw new Error("No active round");

    const userSlots = await storage.getUserSlots(userId);
    if ((userSlots[playerIndex]?.balance ?? 0) < amount)
      throw new Error("Insufficient balance");

    const newBalance = (userSlots[playerIndex]?.balance ?? 0) - amount;
    await storage.updateSlotBalance(userId, playerIndex, newBalance);

    const bet = await storage.placeBet(
      this.currentRoundId,
      userId,
      playerIndex,
      amount,
      autoCashout,
    );

    this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      slots: await storage.getUserSlots(userId),
    });
    this.broadcast(wsEvents.SERVER_BET_PLACED, {
      ...bet,
      user: { id: userId },
      playerIndex,
    });

    if (saveNextBet) {
      if (!this.nextBets[userId]) this.nextBets[userId] = {};
      this.nextBets[userId][playerIndex] = { amount, autoCashout };
    }

    return bet;
  }

  // ---------------------------
  // Cashout
  // ---------------------------
  public async handleCashout(
    userId: number,
    cashoutValue?: number,
    playerIndex: number = 0,
  ) {
    if (this.status !== "active") throw new Error("Round is not active");
    if (!this.currentRoundId) throw new Error("No active round");

    const activeBets = await storage.getActiveBets(this.currentRoundId);
    const bet = activeBets.find(
      (b) =>
        b.userId === userId &&
        b.status === "active" &&
        b.playerIndex === playerIndex,
    );
    if (!bet) throw new Error("No active bet for this slot");

    const cashoutMul = cashoutValue || this.multiplier;
    if (cashoutMul > this.crashPoint) throw new Error("Already crashed");

    const winAmount = Math.floor(bet.amount * cashoutMul);
    await storage.updateBetStatus(bet.id, "won", cashoutMul, winAmount);

    const slot = await storage.getSlot(userId, playerIndex);
    if (slot) {
      await storage.updateSlotBalance(
        userId,
        playerIndex,
        slot.balance + winAmount,
      );
      const allSlots = await storage.getUserSlots(userId);
      this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
        slots: allSlots,
      });
    }

    this.broadcast(wsEvents.SERVER_BET_CASHED_OUT, {
      bet: { ...bet, status: "won", cashoutMultiplier: cashoutMul, winAmount },
      user: { id: userId },
    });

    return winAmount;
  }

  // ---------------------------
  // State helpers
  // ---------------------------
  private broadcastState() {
    this.broadcast(wsEvents.SERVER_STATE_UPDATE, this.getStatus());
  }

  public getStatus() {
    return {
      status: this.status,
      multiplier: this.multiplier,
      roundId: this.currentRoundId,
      elapsed: this.status === "active" ? Date.now() - this.startTime : 0,
    };
  }
}
