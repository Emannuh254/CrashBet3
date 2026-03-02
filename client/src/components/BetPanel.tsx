import React, { useState, useMemo, useEffect } from "react";
import { type GameState, type PlayerBet } from "@/hooks/use-game";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import confetti from "canvas-confetti";
import { useToast } from "@/hooks/use-toast";

// Format number to KSH without decimals
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
  const [step, setStep] = useState<number>(10);
  const [autoInput, setAutoInput] = useState<number>(2.0);
  const [useAuto, setUseAuto] = useState(false);
  const [betNext, setBetNext] = useState(false); // Track "Bet Next"

  const balance = slotBalances[index] ?? 0;
  const placing = placingSlots[index] ?? false;
  const cashing = cashingSlots[index] ?? false;

  // Filter slot-specific bets
  const mySlotBets = myBets.filter((b) => b.playerIndex === index);
  const activeBet = mySlotBets.find((b) => b.bet.status === "active");
  const wonBet = mySlotBets.find((b) => b.bet.status === "won");
  const lostBet = mySlotBets.find((b) => b.bet.status === "lost");

  const isBetting = gameState.status === "betting";
  const isActive = gameState.status === "active";

  const canBet = !activeBet && balance >= MIN_BET && !placing;
  const canCashout = !!activeBet && isActive && !cashing;

  // Display balance optimistically if placing
  const displayBalance =
    placing && canBet ? Math.max(0, balance - amountInput) : balance;

  // Calculate current win for active bet
  const currentWin = useMemo(() => {
    if (!activeBet) return 0;
    return (
      activeBet.bet.winAmount ??
      Math.floor(activeBet.bet.amount * gameState.multiplier)
    );
  }, [activeBet, gameState.multiplier]);

  const adjustAmount = (delta: number) =>
    setAmountInput((prev) => Math.max(MIN_BET, prev + delta * step));

  // --- PLACE BET ---
  const handlePlaceBet = async () => {
    if (!canBet) return;
    if (amountInput < MIN_BET || amountInput > balance) {
      toast({
        title: "Invalid Bet",
        description:
          amountInput < MIN_BET
            ? `Minimum bet is ${MIN_BET} KSH`
            : "Bet exceeds slot balance",
        variant: "destructive",
      });
      return;
    }
    if (useAuto && autoInput < 1.01) {
      toast({
        title: "Invalid AutoCashout",
        description: "Minimum autoCashout is 1.01x",
        variant: "destructive",
      });
      return;
    }

    setPlacingSlots((prev) => ({ ...prev, [index]: true }));
    try {
      await onPlaceBet(amountInput, useAuto ? autoInput : null, index);
      toast({
        title: "Bet Placed",
        description: `Slot ${index + 1} bet placed successfully`,
        variant: "default",
      });
    } catch (err: any) {
      toast({
        title: "Bet Failed",
        description: err?.message ?? "Failed to place bet",
        variant: "destructive",
      });
    } finally {
      setPlacingSlots((prev) => ({ ...prev, [index]: false }));
    }
  };

  // --- CASHOUT ---
  const handleCashout = async () => {
    if (!canCashout) return;

    setCashingSlots((prev) => ({ ...prev, [index]: true }));
    try {
      await onCashout(index);
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.6 },
        colors: ["#00ff66", "#fff"],
      });
      toast({
        title: "Cashout Successful",
        description: `You cashed out ${formatKsh(currentWin)} KSH`,
        variant: "default",
      });
    } catch (err: any) {
      toast({
        title: "Cashout Failed",
        description: err?.message ?? "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setCashingSlots((prev) => ({ ...prev, [index]: false }));
    }
  };

  // --- BET NEXT ---
  useEffect(() => {
    if (isBetting && betNext && !activeBet) {
      handlePlaceBet();
      setBetNext(false);
    }
  }, [isBetting, betNext, activeBet]); // ✅ fixed dependencies

  // --- BUTTON STATE ---
  let buttonText = "Waiting...";
  let buttonColor = "bg-secondary opacity-50";
  let glow = "";

  if (canBet) {
    buttonText = placing ? "Placing..." : "Bet";
    buttonColor = placing
      ? "bg-gray-500 cursor-not-allowed"
      : "bg-primary hover:bg-primary/90";
  } else if (canCashout) {
    buttonText = `Cash Out ${formatKsh(currentWin)} KSH`;
    buttonColor = "bg-yellow-400 hover:bg-yellow-500 text-white";
    glow = "animate-pulse";
  } else if (wonBet) {
    buttonText = `Won ${formatKsh(wonBet.bet.winAmount ?? 0)} KSH`;
    buttonColor = "bg-green-500/20 border border-green-500/50 text-green-500";
    glow = "animate-pulse";
  } else if (lostBet) {
    buttonText = "Crashed";
    buttonColor =
      "bg-destructive/10 border border-destructive/30 text-destructive";
  }

  return (
    <div className="bg-card rounded-xl p-4 border border-border shadow-lg flex flex-col gap-3 relative overflow-hidden">
      {/* Slot header */}
      <div className="absolute top-2 right-2 text-[10px] font-bold text-muted-foreground uppercase opacity-50">
        Slot {index + 1} - {formatKsh(displayBalance)} KSH
      </div>

      {/* Step buttons */}
      <div className="flex gap-1 justify-center mb-1">
        {[10, 100, 1000].map((s) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            disabled={placing || !!activeBet}
            className={`w-10 h-7 rounded-md text-white ${
              step === s ? "bg-primary" : "bg-black"
            } text-[12px]`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => adjustAmount(-1)}
          disabled={placing || !!activeBet}
          className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center"
        >
          -
        </button>
        <Input
          type="number"
          value={amountInput}
          onChange={(e) =>
            setAmountInput(
              Math.max(MIN_BET, Math.floor(Number(e.target.value))),
            )
          }
          disabled={placing || !!activeBet}
          className="h-10 text-center font-mono flex-1"
        />
        <button
          onClick={() => adjustAmount(1)}
          disabled={placing || !!activeBet}
          className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center"
        >
          +
        </button>
      </div>

      {/* AutoCashout */}
      <div className="space-y-1 mt-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] font-bold uppercase text-muted-foreground">
            Auto
          </Label>
          <input
            type="checkbox"
            checked={useAuto}
            onChange={(e) => setUseAuto(e.target.checked)}
            disabled={placing || !!activeBet}
            className="w-3 h-3 accent-primary"
          />
        </div>
        <Input
          type="number"
          value={autoInput}
          onChange={(e) => setAutoInput(Math.max(1.01, Number(e.target.value)))}
          disabled={!useAuto || placing || !!activeBet}
          min={1.01}
          step={0.01}
          className="h-8 bg-background border-border text-sm font-mono"
        />
      </div>

      {/* Action Button */}
      <div className="h-12 mt-auto flex flex-col gap-1">
        <Button
          onClick={
            canBet ? handlePlaceBet : canCashout ? handleCashout : undefined
          }
          disabled={placing || cashing || (!canBet && !canCashout)}
          className={`w-full h-full text-xs font-bold uppercase tracking-wider flex items-center justify-center ${buttonColor} ${glow}`}
        >
          {buttonText}
        </Button>
        {/* Bet Next toggle */}
        {!activeBet && isBetting && (
          <Button
            size="sm"
            onClick={() => setBetNext((prev) => !prev)}
            className={`mt-1 w-full text-xs ${
              betNext ? "bg-blue-500" : "bg-gray-700"
            }`}
          >
            {betNext ? "Bet Next ✅" : "Bet Next"}
          </Button>
        )}
      </div>
    </div>
  );
}
