import React, { useState, useMemo, useEffect } from "react";
import { type GameState, type PlayerBet } from "@/hooks/use-game";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import confetti from "canvas-confetti";
import { useToast } from "@/hooks/use-toast";

function formatKsh(amount: number) {
  return Math.floor(amount).toLocaleString("en-KE");
}

interface BetPanelProps {
  gameState: GameState;
  myBets: PlayerBet[];
  onPlaceBet: (
    amount: number,
    autoCashout?: number | null,
    playerIndex?: number,
    queueForNext?: boolean,
  ) => Promise<any>;
  onCashout: (playerIndex: number) => Promise<any>;
  placingSlots: Record<number, boolean>;
  cashingSlots: Record<number, boolean>;
  setPlacingSlots: React.Dispatch<
    React.SetStateAction<Record<number, boolean>>
  >;
  setCashingSlots: React.Dispatch<
    React.SetStateAction<Record<number, boolean>>
  >;
  slotBalances: Record<number, number>;
}

export function BetPanel(props: BetPanelProps) {
  const { slotBalances } = props;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 w-full">
      {Object.keys(slotBalances).map((k) => {
        const index = Number(k);
        return <BetSlot key={index} index={index} {...props} />;
      })}
    </div>
  );
}
function BetSlot({
  index,
  gameState,
  myBets,
  onPlaceBet,
  onCashout,
  placingSlots,
  cashingSlots,
  setPlacingSlots,
  setCashingSlots,
  slotBalances,
}: BetPanelProps & { index: number }) {
  const { toast } = useToast();
  const MIN_BET = 10;

  const [amountInput, setAmountInput] = useState<number>(MIN_BET);
  const [step] = useState<number>(10);
  const [autoInput, setAutoInput] = useState<number>(2.0);
  const [useAuto, setUseAuto] = useState(false);
  const [justCashed, setJustCashed] = useState(false);
  const [localBet, setLocalBet] = useState<PlayerBet | null>(null);
  // New: track queued bets per slot (optimistic + persistent across phases)
  const [queuedBets, setQueuedBets] = useState<Record<number, boolean>>({});

  const balance = slotBalances[index] ?? 0;
  const placing = placingSlots[index] ?? false;
  const cashing = cashingSlots[index] ?? false;

  const slotBets = myBets.filter((b) => b.playerIndex === index);
  const activeBet = slotBets.find((b) => b.bet.status === "active") ?? localBet;
  const wonBet = slotBets.find((b) => b.bet.status === "won");
  const lostBet = slotBets.find((b) => b.bet.status === "lost");

  const isBettingPhase = gameState.status === "betting";
  const isActivePhase = gameState.status === "active";
  const isCrashedPhase = gameState.status === "crashed";

  const hasActiveBet = !!activeBet && activeBet.bet.status === "active";
  const hasQueuedBet = queuedBets[index] === true;

  // ─── Action permissions ────────────────────────────────────────
  const canCashout = hasActiveBet && isActivePhase && !cashing;

  const canPlaceImmediate =
    isBettingPhase &&
    !hasActiveBet &&
    !hasQueuedBet &&
    balance >= MIN_BET &&
    !placing &&
    !cashing;

  const canQueueNext =
    !hasActiveBet &&
    !hasQueuedBet &&
    balance >= MIN_BET &&
    !placing &&
    !cashing &&
    (isActivePhase || isCrashedPhase);

  const canBetSomething = canPlaceImmediate || canQueueNext;

  // ─── Display logic ─────────────────────────────────────────────
  const displayBalance = placing ? Math.max(0, balance - amountInput) : balance;

  const currentWin = useMemo(() => {
    if (!activeBet) return 0;
    return (
      activeBet.bet.winAmount ??
      Math.floor((activeBet.bet.amount ?? 0) * gameState.multiplier)
    );
  }, [activeBet, gameState.multiplier]);

  const adjustAmount = (delta: number) =>
    setAmountInput((prev) => Math.max(MIN_BET, prev + delta * step));

  // ─── Bet action ────────────────────────────────────────────────
  const handleBetAction = async () => {
    if (amountInput < MIN_BET || amountInput > balance) {
      toast({
        title: "Invalid Bet",
        description: amountInput < MIN_BET ? "Min 10 KSH" : "Exceeds balance",
        variant: "destructive",
      });
      return;
    }

    if (useAuto && autoInput < 1.01) {
      toast({
        title: "Invalid Auto",
        description: "Min 1.01×",
        variant: "destructive",
      });
      return;
    }

    setPlacingSlots((p) => ({ ...p, [index]: true }));

    const tempBet: PlayerBet = {
      bet: {
        id: Date.now(),
        userId: 1,
        amount: amountInput,
        status: "active", // optimistic
        winAmount: null,
        cashoutMultiplier: useAuto ? autoInput : null,
        autoCashout: useAuto ? autoInput : null,
        createdAt: Date.now(),
      },
      user: { id: 1, username: "You" },
      playerIndex: index,
    };
    setLocalBet(tempBet);

    try {
      const shouldQueue = !isBettingPhase;

      await onPlaceBet(
        amountInput,
        useAuto ? autoInput : null,
        index,
        shouldQueue,
      );

      // On success → mark as queued (if it was queue action)
      if (shouldQueue) {
        setQueuedBets((prev) => ({ ...prev, [index]: true }));
      }

      toast({
        title: shouldQueue ? "Queued" : "Placed",
        description: `Slot ${index + 1} ${shouldQueue ? "queued for next round" : "bet placed"}`,
        variant: "default",
      });
    } catch (err: any) {
      toast({
        title: "Failed",
        description: err.message || "Could not place/queue bet",
        variant: "destructive",
      });
      setLocalBet(null);
    } finally {
      setPlacingSlots((p) => ({ ...p, [index]: false }));
    }
  };

  // ─── Cashout action ────────────────────────────────────────────
  const handleCashout = async () => {
    if (!canCashout) return;
    setCashingSlots((p) => ({ ...p, [index]: true }));

    try {
      const winEstimate = currentWin;
      await onCashout(index);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      toast({
        title: "Cashed Out!",
        description: `+${formatKsh(winEstimate)} KSH`,
      });
      setJustCashed(true);
      setTimeout(() => setJustCashed(false), 4500);
    } catch (err: any) {
      toast({
        title: "Cashout Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setCashingSlots((p) => ({ ...p, [index]: false }));
    }
  };

  // Reset queued state when new betting phase starts (fresh round)
  useEffect(() => {
    if (isBettingPhase) {
      setQueuedBets((prev) => {
        const next = { ...prev };
        delete next[index]; // clear queue flag for this slot
        return next;
      });
      setLocalBet(null);
      setJustCashed(false);
    }
  }, [isBettingPhase, index]);

  useEffect(() => {
    if (isCrashedPhase) {
      setLocalBet(null);
      setJustCashed(false);
    }
  }, [isCrashedPhase]);

  // ─── Button appearance ─────────────────────────────────────────
  let buttonText = "Waiting...";
  let buttonColor = "bg-secondary opacity-50";
  let glow = "";
  let opacityClass = "";

  if (justCashed) {
    buttonText = "Cashed Out!";
    buttonColor = "bg-green-600 text-white animate-pulse";
  } else if (wonBet) {
    buttonText = `Won ${formatKsh(wonBet.bet.winAmount ?? 0)} KSH`;
    buttonColor =
      "bg-green-500/30 border-green-500/50 text-green-400 animate-pulse";
  } else if (lostBet) {
    buttonText = "Lost";
    buttonColor = "bg-red-500/20 border-red-500/40 text-red-400";
  } else if (canCashout) {
    buttonText = `Cash Out ${formatKsh(currentWin)} KSH`;
    buttonColor = "bg-yellow-400 hover:bg-yellow-500 text-black animate-pulse";
    glow = "shadow-lg shadow-yellow-400/50";
  } else if (canQueueNext) {
    buttonText = placing ? "Queuing..." : "Bet Next";
    buttonColor = "bg-indigo-600 hover:bg-indigo-700 text-white";
  } else if (canPlaceImmediate) {
    buttonText = placing ? "Placing..." : "Place Bet";
    buttonColor = "bg-blue-600 hover:bg-blue-700 text-white";
  } else {
    // Fallback for disabled states
    if (hasQueuedBet) {
      buttonText = "Queued";
      opacityClass = "opacity-60 cursor-not-allowed";
    }
  }

  // Disable when already queued, placing, cashing, or no action possible
  const buttonDisabled =
    placing || cashing || hasQueuedBet || (!canCashout && !canBetSomething);

  const handleClick = () => {
    if (buttonDisabled) return;

    if (canCashout) {
      handleCashout();
    } else if (canBetSomething) {
      handleBetAction();
    }
  };

  return (
    <div className="bg-card rounded-xl p-4 border border-border shadow-lg flex flex-col gap-3 relative overflow-hidden">
      <div className="absolute top-2 right-2 text-xs font-bold">
        Slot {index + 1} •{" "}
        <span
          className={
            balance > 0 ? "text-green-400 font-medium" : "text-muted-foreground"
          }
        >
          {formatKsh(displayBalance)} KSH
        </span>
      </div>

      {/* Quick presets */}
      <div className="flex gap-1 justify-center flex-wrap">
        {[10, 50, 100, 500, 1000].map((v) => (
          <button
            key={v}
            onClick={() => setAmountInput(v)}
            disabled={placing || hasActiveBet || hasQueuedBet}
            className={`px-3 py-1 text-xs rounded ${
              amountInput === v
                ? "bg-primary text-white"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Amount */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => adjustAmount(-1)}
          disabled={placing || hasActiveBet || hasQueuedBet}
          className="w-9 h-9 rounded-full bg-muted flex-center text-lg font-bold"
        >
          −
        </button>
        <Input
          type="number"
          value={amountInput}
          onChange={(e) =>
            setAmountInput(
              Math.max(MIN_BET, Math.floor(Number(e.target.value) || MIN_BET)),
            )
          }
          disabled={placing || hasActiveBet || hasQueuedBet}
          className="text-center font-mono"
        />
        <button
          onClick={() => adjustAmount(1)}
          disabled={placing || hasActiveBet || hasQueuedBet}
          className="w-9 h-9 rounded-full bg-muted flex-center text-lg font-bold"
        >
          +
        </button>
      </div>

      {/* Auto */}
      <div className="flex items-center justify-between text-xs">
        <Label className="text-muted-foreground">Auto Cashout</Label>
        <input
          type="checkbox"
          checked={useAuto}
          onChange={(e) => setUseAuto(e.target.checked)}
          disabled={placing || hasActiveBet || hasQueuedBet}
          className="h-4 w-4 accent-primary"
        />
      </div>

      {useAuto && (
        <Input
          type="number"
          step="0.01"
          min="1.01"
          value={autoInput}
          onChange={(e) => setAutoInput(Math.max(1.01, Number(e.target.value)))}
          disabled={placing || hasActiveBet || hasQueuedBet}
          className="h-8 text-sm"
        />
      )}

      {/* Action button */}
      <Button
        onClick={handleClick}
        disabled={buttonDisabled}
        className={`h-12 text-sm font-semibold uppercase tracking-wide ${buttonColor} ${glow} ${opacityClass}`}
      >
        {buttonText}
      </Button>
    </div>
  );
}
