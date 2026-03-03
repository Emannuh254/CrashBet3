import type { Express } from "express";
import { Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { GameEngine } from "./game";
import { api, errorSchemas, wsEvents } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  setupAuth(app);

  const gameEngine = new GameEngine(httpServer);

  app.get(api.game.state.path, (req, res) => {
    res.json(gameEngine.getStatus());
  });

  app.get(api.game.history.path, async (req, res) => {
    const rounds = await storage.getRecentRounds(20);
    res.json(rounds);
  });

  app.get(api.bets.current.path, async (req, res) => {
    const state = gameEngine.getStatus();
    if (!state.roundId) return res.json([]);
    const bets = await storage.getActiveBets(state.roundId);
    // Include user information and player index
    res.json(
      bets.map((b) => ({ bet: b, user: b.user, playerIndex: b.playerIndex })),
    );
  });

  app.get("/api/slots", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    await storage.ensureSlots(req.user.id);
    const slots = await storage.getUserSlots(req.user.id);
    res.json(slots);
  });

  app.post(api.bets.place.path, async (req, res) => {
    if (!req.isAuthenticated())
      return res.status(401).json({ message: "Please log in first" });

    // ─── DEBUG: log exactly what arrived ────────────────────────────────
    console.log(
      "[POST /api/bets] Raw body:",
      JSON.stringify(req.body, null, 2),
    );
    console.log(
      "[POST /api/bets] playerIndex type:",
      typeof req.body.playerIndex,
    );
    console.log("[POST /api/bets] playerIndex value:", req.body.playerIndex);

    try {
      // Force conversion to number (safety net)
      if (typeof req.body.amount === "string") {
        req.body.amount = parseInt(req.body.amount, 10);
      }
      if (typeof req.body.playerIndex === "string") {
        req.body.playerIndex = parseInt(req.body.playerIndex, 10);
      } else if (
        typeof req.body.playerIndex !== "number" ||
        isNaN(req.body.playerIndex)
      ) {
        // This is your bug — log it clearly
        console.error(
          "[POST /api/bets] Invalid playerIndex:",
          req.body.playerIndex,
        );
        return res
          .status(400)
          .json({ message: "playerIndex must be a number" });
      }
      if (
        typeof req.body.autoCashout === "string" &&
        req.body.autoCashout !== ""
      ) {
        req.body.autoCashout = parseFloat(req.body.autoCashout);
      } else if (
        req.body.autoCashout === "" ||
        req.body.autoCashout === undefined
      ) {
        req.body.autoCashout = null;
      }

      // Now validate
      const input = api.bets.place.input.parse(req.body);
      const playerIndex = input.playerIndex ?? 0;

      const user = await storage.getUser(req.user.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const slot = await storage.getSlot(user.id, playerIndex);
      if (!slot || slot.balance < input.amount) {
        return res
          .status(400)
          .json({ message: "Insufficient balance in this slot" });
      }

      const state = gameEngine.getStatus();
      const targetRoundId = state.roundId;

      // Allow queuing even outside betting phase
      if (!req.body.saveNextBet && state.status !== "betting") {
        return res.status(400).json({
          message: "You can only place immediate bets during the betting phase",
        });
      }

      // If queuing (saveNextBet: true), we don't need to check existing bets or deduct now
      if (!req.body.saveNextBet) {
        const existingBets = await storage.getUserActiveBets(
          user.id,
          targetRoundId,
        );
        if (existingBets.some((b) => b.playerIndex === playerIndex)) {
          return res
            .status(400)
            .json({ message: `Slot ${playerIndex + 1} is already booked` });
        }

        const newBalance = slot.balance - input.amount;
        await storage.updateSlotBalance(user.id, playerIndex, newBalance);

        const allSlots = await storage.getUserSlots(user.id);
        gameEngine.sendToUser(user.id, wsEvents.SERVER_BALANCE_UPDATE, {
          slots: allSlots,
        });
      }

      // Create the bet (for immediate) or let GameEngine queue it
      const bet = await storage.createBet({
        ...input,
        userId: user.id,
        roundId: targetRoundId,
        playerIndex,
      });

      if (!req.body.saveNextBet && targetRoundId === state.roundId) {
        gameEngine.broadcast(wsEvents.SERVER_BET_PLACED, { bet, user });
      }

      res.status(201).json(bet);
    } catch (e) {
      console.error("Place bet error:", e);
      if (e instanceof z.ZodError) {
        return res.status(400).json({
          message: e.errors[0].message,
          details: e.errors, // ← show full error for debugging
        });
      }
      res.status(500).json({ message: "Something went wrong" });
    }
  });

  app.post(api.bets.cashout.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const playerIndex =
      typeof req.body.playerIndex === "number"
        ? req.body.playerIndex
        : parseInt(req.body.playerIndex || "0");

    try {
      const winAmount = await gameEngine.handleCashout(
        req.user.id,
        undefined,
        playerIndex,
      );
      res.json({ message: "Cashed out successfully", winAmount });
    } catch (e: any) {
      console.error("Cashout error:", e);
      res.status(400).json({ message: e.message || "Failed to cash out" });
    }
  });

  // Admin Routes
  app.get("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) return res.sendStatus(403);
    const users = await storage.getAllUsers();
    res.json(users.map(({ password, ...u }) => u));
  });

  app.post("/api/admin/grant-coins", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) return res.sendStatus(403);
    const { userId, amount, playerIndex } = req.body;

    if (typeof amount !== "number")
      return res.status(400).json({ message: "Invalid amount" });
    if (typeof playerIndex !== "number")
      return res.status(400).json({ message: "Invalid slot" });

    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    await storage.ensureSlots(userId);
    const slot = await storage.getSlot(userId, playerIndex);
    if (!slot) return res.status(404).json({ message: "Slot not found" });

    const cents = Math.round(amount * 100);
    const newBalance = slot.balance + cents;
    await storage.updateSlotBalance(userId, playerIndex, newBalance);

    const allSlots = await storage.getUserSlots(userId);
    gameEngine.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      slots: allSlots,
    });

    res.json({ success: true, balance: newBalance });
  });

  app.post("/api/admin/set-balance", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) return res.sendStatus(403);
    const { userId, balance, playerIndex } = req.body;

    if (typeof balance !== "number")
      return res.status(400).json({ message: "Invalid balance" });
    if (typeof playerIndex !== "number")
      return res.status(400).json({ message: "Invalid slot" });

    const user = await storage.getUser(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    await storage.ensureSlots(userId);
    const slot = await storage.getSlot(userId, playerIndex);
    if (!slot) return res.status(404).json({ message: "Slot not found" });

    const cents = Math.round(balance * 100);
    await storage.updateSlotBalance(userId, playerIndex, cents);

    const allSlots = await storage.getUserSlots(userId);
    gameEngine.sendToUser(userId, wsEvents.SERVER_BALANCE_UPDATE, {
      slots: allSlots,
    });

    res.json({ success: true, balance: cents });
  });

  return httpServer;
}
