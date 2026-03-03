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
  private nextBets: Record<number, Record<number, NextBet>> = {};

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.setupWebSocket();
    this.startNewRound();
  }

  // ────────────────────────────────────────────────
  // WebSocket & Heartbeat
  // ────────────────────────────────────────────────
  private setupWebSocket() {
    this.wss.on("connection", (ws: Client) => {
      ws.isAlive = true;
      ws.on("pong", () => (ws.isAlive = true));

      ws.on("message", (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === "auth" && typeof data.userId === "number") {
            ws.userId = data.userId;
            ws.username = data.username;
          }
        } catch (err) {
          console.warn("Invalid WS message:", err);
        }
      });

      // Send current game state immediately to new client
      ws.send(
        JSON.stringify({
          type: wsEvents.SERVER_STATE_UPDATE,
          payload: this.getStatus(),
        }),
      );
    });

    // Heartbeat: ping clients every 30s, terminate if no pong
    const heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = ws as Client;
        if (!client.isAlive) {
          client.terminate();
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    this.wss.on("close", () => clearInterval(heartbeatInterval));
  }

  // ────────────────────────────────────────────────
  // Broadcast Helpers
  // ────────────────────────────────────────────────
  private broadcast(type: string, payload: any) {
    const message = JSON.stringify({ type, payload });
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private sendToUser(userId: number, type: string, payload: any) {
    const message = JSON.stringify({ type, payload });
    this.wss.clients.forEach((client) => {
      const c = client as Client;
      if (c.readyState === WebSocket.OPEN && c.userId === userId) {
        c.send(message);
      }
    });
  }

  // ────────────────────────────────────────────────
  // Provably Fair Crash Point Generation
  // ────────────────────────────────────────────────
  private generateCrashPoint(): number {
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

  // ────────────────────────────────────────────────
  // Round Lifecycle
  // ────────────────────────────────────────────────
  private async startNewRound(): Promise<void> {
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

      // Combined round start + state update (reduces client race conditions)
      this.broadcast(wsEvents.SERVER_ROUND_START, {
        roundId: this.currentRoundId,
        ...this.getStatus(),
      });

      // 5-second betting window
      this.bettingTimeout = setTimeout(() => this.startGame(), 5000);
    } catch (error) {
      console.error("Failed to start new round:", error);
      setTimeout(() => this.startNewRound(), 2000);
    }
  }

  private async startGame(): Promise<void> {
    if (this.status !== "betting") return;

    this.status = "active";
    this.startTime = Date.now();

    if (this.currentRoundId) {
      await storage.updateRoundStatus(this.currentRoundId, "active");
    }

    this.broadcast(wsEvents.SERVER_STATE_UPDATE, this.getStatus());

    this.gameLoop = setInterval(() => this.tick(), 50);
    this.stateBroadcastInterval = setInterval(() => this.broadcastState(), 100);

    // Auto-place queued bets for this round
    for (const userIdStr in this.nextBets) {
      const userId = Number(userIdStr);
      for (const slotStr in this.nextBets[userId]) {
        const slot = Number(slotStr);
        const queued = this.nextBets[userId][slot];
        this.placeBet(
          userId,
          slot,
          queued.amount,
          queued.autoCashout,
          false,
        ).catch((err) => console.warn("Auto-place queued bet failed:", err));
      }
    }

    this.nextBets = {};
  }

  private clearTimers(): void {
    [this.gameLoop, this.stateBroadcastInterval, this.bettingTimeout].forEach(
      (timer) => timer && clearInterval(timer),
    );
    this.gameLoop = null;
    this.stateBroadcastInterval = null;
    this.bettingTimeout = null;
  }

  // ────────────────────────────────────────────────
  // Game Tick (multiplier growth + auto-cashout)
  // ────────────────────────────────────────────────
  private async tick(): Promise<void> {
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
          ).catch((err) => console.warn("Auto-cashout failed:", err));
        }
      }),
    );
  }

  // ────────────────────────────────────────────────
  // Crash Round
  // ────────────────────────────────────────────────
  private async crash(): Promise<void> {
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
      multiplier: this.multiplier,
      timestamp: Date.now(),
    });

    this.broadcastState();

    // Short delay before new round
    setTimeout(() => this.startNewRound(), 3000);
  }

  // ────────────────────────────────────────────────
  // Place Bet (immediate or queued)
  // ────────────────────────────────────────────────
  public async placeBet(
    userId: number,
    playerIndex: number,
    amount: number,
    autoCashout?: number | null,
    saveNextBet: boolean = false,
  ) {
    if (!this.currentRoundId) {
      throw new Error("No active round available");
    }

    // Allow queuing anytime; immediate bets only during betting phase
    if (!saveNextBet && this.status !== "betting") {
      throw new Error(
        "Cannot place immediate bet now — please queue for the next round",
      );
    }

    const userSlots = await storage.getUserSlots(userId);
    const slot = userSlots[playerIndex];

    if (!slot) {
      throw new Error(`Slot ${playerIndex + 1} not found for user ${userId}`);
    }

    const slotBalance = slot.balance ?? 0;

    if (slotBalance < amount) {
      throw new Error("Insufficient balance");
    }

    const newBalance = slotBalance - amount;
    await storage.updateSlotBalance(userId, playerIndex, newBalance);

    const bet = await storage.placeBet(
      this.currentRoundId,
      userId,
      playerIndex,
      amount,
      autoCashout,
    );

    // Notify user of balance change
    this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      slots: await storage.getUserSlots(userId),
    });

    // Broadcast bet placement to everyone
    this.broadcast(wsEvents.SERVER_BET_PLACED, {
      bet: {
        id: bet.id,
        roundId: this.currentRoundId,
        userId: bet.userId,
        playerIndex,
        amount: bet.amount,
        autoCashout: bet.autoCashout ?? null,
        status: bet.status,
        createdAt: bet.createdAt ?? Date.now(),
      },
      user: { id: userId },
    });

    // Queue for next round if requested
    if (saveNextBet) {
      if (!this.nextBets[userId]) {
        this.nextBets[userId] = {};
      }
      this.nextBets[userId][playerIndex] = { amount, autoCashout };
    }

    return bet;
  }

  // ────────────────────────────────────────────────
  // Cashout Bet
  // ────────────────────────────────────────────────
  public async handleCashout(
    userId: number,
    cashoutValue?: number,
    playerIndex: number = 0,
  ): Promise<number> {
    if (this.status !== "active") {
      throw new Error("Round is not active");
    }

    if (!this.currentRoundId) {
      throw new Error("No active round");
    }

    const activeBets = await storage.getActiveBets(this.currentRoundId);
    const bet = activeBets.find(
      (b) =>
        b.userId === userId &&
        b.status === "active" &&
        b.playerIndex === playerIndex,
    );

    if (!bet) {
      throw new Error("No active bet found for this slot");
    }

    const cashoutMultiplier = cashoutValue ?? this.multiplier;

    // Prevent late/invalid cashouts
    if (cashoutMultiplier > this.crashPoint + 0.001) {
      console.warn(
        `Rejected late cashout - user:${userId} slot:${playerIndex} ` +
          `req:${cashoutMultiplier.toFixed(3)} crash:${this.crashPoint.toFixed(3)}`,
      );
      throw new Error("Cashout value exceeds crash point");
    }

    const winAmount = Math.floor(bet.amount * cashoutMultiplier);

    await storage.updateBetStatus(bet.id, "won", cashoutMultiplier, winAmount);

    const slot = await storage.getSlot(userId, playerIndex);
    if (slot) {
      await storage.updateSlotBalance(
        userId,
        playerIndex,
        slot.balance + winAmount,
      );

      this.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
        slots: await storage.getUserSlots(userId),
      });
    }

    // Broadcast cashout event
    this.broadcast(wsEvents.SERVER_BET_CASHED_OUT, {
      bet: {
        id: bet.id,
        roundId: this.currentRoundId,
        userId: bet.userId,
        playerIndex: bet.playerIndex,
        amount: bet.amount,
        autoCashout: bet.autoCashout ?? null,
        status: "won",
        cashoutMultiplier,
        winAmount,
        createdAt: bet.createdAt ?? Date.now(),
      },
      user: { id: userId },
      timestamp: Date.now(),
    });

    return winAmount;
  }

  // ────────────────────────────────────────────────
  // State Helpers
  // ────────────────────────────────────────────────
  private broadcastState(): void {
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
