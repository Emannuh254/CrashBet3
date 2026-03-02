import React from "react";
import { type Round } from "@shared/schema";

interface HistoryBarProps {
  history: Round[];
}

export function HistoryBar({ history }: HistoryBarProps) {
  // Show last 10 rounds
  const recent = history.slice(0, 15);

  return (
    <div className="w-full flex gap-2 overflow-x-auto pb-2 custom-scrollbar items-center">
      <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mr-2 shrink-0">
        History
      </div>
      {recent.map(round => {
        const crash = round.crashPoint;
        // Color code based on multiplier
        let color = "text-muted-foreground bg-secondary"; // default low
        let glow = "";
        
        if (crash >= 10) {
          color = "text-yellow-400 bg-yellow-400/10 border border-yellow-400/30";
          glow = "shadow-[0_0_10px_rgba(250,204,21,0.2)]";
        } else if (crash >= 2) {
          color = "text-primary bg-primary/10 border border-primary/30";
          glow = "shadow-[0_0_10px_rgba(255,42,95,0.2)]";
        }

        return (
          <div 
            key={round.id} 
            className={`shrink-0 px-3 py-1 rounded-md text-xs font-mono font-bold transition-all hover:scale-105 cursor-default ${color} ${glow}`}
            title={`Round ${round.id}`}
          >
            {crash.toFixed(2)}x
          </div>
        )
      })}
      {recent.length === 0 && (
        <span className="text-xs text-muted-foreground">Loading...</span>
      )}
    </div>
  );
}
