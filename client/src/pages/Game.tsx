import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGame } from "@/hooks/use-game";
import { useLocation } from "wouter";
import { GameCanvas } from "@/components/GameCanvas";
import { BetPanel } from "@/components/BetPanel";
import { LiveBets } from "@/components/LiveBets";
import { HistoryBar } from "@/components/HistoryBar";
import { Button } from "@/components/ui/button";
import { LogOut, User, Wallet } from "lucide-react";

// Format KSH without decimals (matches BetPanel)
function formatKsh(amount: number) {
  return Math.floor(amount).toLocaleString("en-KE");
}

export default function GamePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  // useGame now includes slotBalances
  const {
    gameState,
    activeBets,
    history,
    myBets,
    placeBet,
    cashout,
    slotBalances: updatedSlotBalances,
  } = useGame();

  // Track per-slot actions
  const [placingSlots, setPlacingSlots] = useState<Record<number, boolean>>({});
  const [cashingSlots, setCashingSlots] = useState<Record<number, boolean>>({});
  const [slotBalances, setSlotBalances] = useState<Record<number, number>>({});

  // Redirect if not logged in
  useEffect(() => {
    if (!user) setLocation("/auth");
  }, [user, setLocation]);

  // Initialize slot balances from user data
  useEffect(() => {
    if (user) {
      setSlotBalances({
        0: user.balance,
        1: user.balance,
        2: user.balance,
        3: user.balance,
        4: user.balance,
      });
    }
  }, [user]);

  // Sync slotBalances whenever updated from useGame (WS updates)
  useEffect(() => {
    if (updatedSlotBalances) {
      setSlotBalances(updatedSlotBalances);
    }
  }, [updatedSlotBalances]);

  // Place bet for a specific slot
  const handlePlaceBet = async (
    amount: number,
    autoCashout?: number | null,
    playerIndex?: number,
  ) => {
    if (playerIndex === undefined) return;
    setPlacingSlots((prev) => ({ ...prev, [playerIndex]: true }));

    try {
      await placeBet({ amount, autoCashout, playerIndex });
    } finally {
      setPlacingSlots((prev) => ({ ...prev, [playerIndex]: false }));
    }
  };

  // Cashout for a specific slot
  const handleCashout = async (playerIndex: number) => {
    setCashingSlots((prev) => ({ ...prev, [playerIndex]: true }));

    try {
      await cashout(playerIndex);
    } finally {
      setCashingSlots((prev) => ({ ...prev, [playerIndex]: false }));
    }
  };

  // Total balance formatted in KSH
  const totalBalance = Object.values(slotBalances).reduce(
    (sum, b) => sum + b,
    0,
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-border/50 bg-card/50 backdrop-blur-md sticky top-0 z-50 flex items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-black tracking-tighter text-primary text-glow">
            CRASH<span className="text-foreground">.BET</span>
          </h1>
        </div>

        <div className="flex items-center gap-6">
          {/* User info */}
          <div className="hidden md:flex items-center gap-2 bg-background/50 px-4 py-2 rounded-full border border-white/5">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="font-bold text-sm">{user?.username}</span>
          </div>

          {/* Total KSH balance */}
          <div className="flex items-center gap-2 bg-success/10 text-success px-4 py-2 rounded-full border border-success/20 box-glow-success">
            <Wallet className="w-4 h-4" />
            <span className="font-mono font-bold">
              {formatKsh(totalBalance)} KSH
            </span>
          </div>

          {/* Logout button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => logout()}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 p-4 lg:p-8 max-w-[1600px] mx-auto w-full flex flex-col gap-6">
        {/* Game history */}
        <div className="w-full bg-card/30 p-2 rounded-xl border border-white/5">
          <HistoryBar history={history} />
        </div>

        <div className="flex flex-col lg:flex-row gap-6 h-full min-h-[600px]">
          {/* Left: Canvas + BetPanel */}
          <div className="flex-1 flex flex-col gap-6">
            <div className="w-full">
              <GameCanvas gameState={gameState} />
            </div>

            <div className="mt-auto">
              <BetPanel
                gameState={gameState}
                myBets={myBets}
                onPlaceBet={handlePlaceBet}
                onCashout={handleCashout}
                placingSlots={placingSlots}
                cashingSlots={cashingSlots}
                setPlacingSlots={setPlacingSlots}
                setCashingSlots={setCashingSlots}
                slotBalances={slotBalances}
              />
            </div>
          </div>

          {/* Right: Live Bets */}
          <div className="w-full lg:w-[400px] shrink-0">
            <LiveBets bets={activeBets} gameState={gameState} />
          </div>
        </div>
      </main>
    </div>
  );
}
