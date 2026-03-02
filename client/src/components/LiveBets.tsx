import React, { useMemo } from "react";
import { type PlayerBet, type GameState } from "@/hooks/use-game";

// Format number as KSH (Kenyan Shillings)
export function formatKsh(amount: number) {
  return Math.floor(amount).toLocaleString("en-KE") + " KSH";
}

interface LiveBetsProps {
  bets: PlayerBet[];
  gameState: GameState;
}

export function LiveBets({ bets, gameState }: LiveBetsProps) {
  // Group bets by slot
  const betsBySlot = useMemo(() => {
    const map: Record<number, PlayerBet[]> = {};
    bets.forEach((b) => {
      if (!map[b.playerIndex]) map[b.playerIndex] = [];
      map[b.playerIndex].push(b);
    });
    return map;
  }, [bets]);

  return (
    <div className="bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 flex flex-col h-[400px] md:h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border/50 bg-background/50 flex justify-between items-center">
        <h3 className="font-bold text-foreground flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Live Bets by Slot
        </h3>
        <div className="text-sm font-mono text-muted-foreground">
          {bets.length} bets |{" "}
          {formatKsh(bets.reduce((a, b) => a + b.bet.amount, 0))}
        </div>
      </div>

      {/* Slots List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {Object.entries(betsBySlot).map(([slotIndex, slotBets]) => (
          <div
            key={slotIndex}
            className="border-b border-border/20 last:border-none pb-2 last:pb-0"
          >
            <div className="flex justify-between items-center mb-1 px-2">
              <span className="font-bold text-sm">
                Slot {Number(slotIndex) + 1}
              </span>
              <span className="text-xs text-muted-foreground">
                Total:{" "}
                {formatKsh(slotBets.reduce((a, b) => a + b.bet.amount, 0))}
              </span>
            </div>

            {slotBets.map((pb) => {
              const isWon = pb.bet.status === "won";
              const isLost = pb.bet.status === "lost";
              const isActive = pb.bet.status === "active";

              const currentWin =
                isActive || isWon
                  ? (pb.bet.winAmount ??
                    Math.floor(pb.bet.amount * gameState.multiplier))
                  : 0;

              let rowClass = "bg-background/20 hover:bg-background/40";
              if (isWon)
                rowClass =
                  "bg-success/10 border border-success/30 text-success";
              if (isLost) rowClass = "opacity-50 grayscale";
              if (isActive && gameState.status === "active")
                rowClass = "bg-yellow-100 text-yellow-800";

              return (
                <div
                  key={pb.bet.id}
                  className={`grid grid-cols-3 gap-2 px-3 py-2 rounded-lg text-sm items-center transition-colors ${rowClass}`}
                >
                  {/* User */}
                  <div className="truncate font-medium flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-secondary flex items-center justify-center text-[10px] text-muted-foreground uppercase">
                      {pb.user.username.slice(0, 2)}
                    </div>
                    {pb.user.username}
                  </div>

                  {/* Bet / Multiplier */}
                  <div className="text-right font-mono flex flex-col">
                    <span className="text-foreground">
                      {formatKsh(pb.bet.amount)}
                    </span>
                    {isWon || isActive ? (
                      <span
                        className={`text-xs ${isWon ? "text-success" : "text-primary"}`}
                      >
                        {isWon
                          ? `${pb.bet.cashoutMultiplier?.toFixed(2)}x`
                          : `x${gameState.multiplier.toFixed(2)}`}
                      </span>
                    ) : (
                      <span className="text-xs">-</span>
                    )}
                  </div>

                  {/* Payout */}
                  <div
                    className={`text-right font-mono font-bold ${isWon ? "text-success text-glow-success" : ""}`}
                  >
                    {isActive || isWon
                      ? formatKsh(currentWin)
                      : isLost
                        ? formatKsh(0)
                        : "-"}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {bets.length === 0 && (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">
            No bets placed yet
          </div>
        )}
      </div>
    </div>
  );
}
