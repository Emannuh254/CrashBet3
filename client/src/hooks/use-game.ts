import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, wsEvents } from "@shared/routes";
import { type Bet } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "./use-auth";

export type GameStatus = "betting" | "active" | "crashed";

export interface GameState {
  status: GameStatus;
  multiplier: number;
  roundId?: number;
  elapsed: number;
  crashPoint?: number;
}

export interface PlayerBet {
  bet: Bet;
  user: { id: number; username: string };
  playerIndex: number;
}

export function useGame() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);

  const MIN_BET = 10;
  const SLOTS_QUERY_KEY = ["slots"];

  const [gameState, setGameState] = useState<GameState>({
    status: "betting",
    multiplier: 1.0,
    elapsed: 0,
  });

  const [activeBets, setActiveBets] = useState<PlayerBet[]>([]);

  // ---------------------------
  // Fetch initial game state
  // ---------------------------
  useQuery({
    queryKey: ["gameState"],
    queryFn: async () => {
      const res = await fetch(api.game.state.path);
      if (!res.ok) return null;
      const data = await res.json();
      setGameState((prev) => ({ ...prev, ...data }));
      return data;
    },
    refetchOnWindowFocus: false,
  });

  // ---------------------------
  // Fetch user slots
  // ---------------------------
  const { data: slots = [] } = useQuery({
    queryKey: SLOTS_QUERY_KEY,
    queryFn: async () => {
      if (!user) return [];
      const res = await fetch("/api/slots", { credentials: "include" });
      if (!res.ok) return [];
      return await res.json();
    },
    refetchInterval: 5000,
  });

  const slotBalances = useMemo(() => {
    const balances: Record<number, number> = {};
    slots.forEach((slot: any, index: number) => {
      balances[index] = slot.balance ?? 0;
    });
    return balances;
  }, [slots]);

  // ---------------------------
  // Fetch game history
  // ---------------------------
  const { data: history = [] } = useQuery({
    queryKey: ["gameHistory"],
    queryFn: async () => {
      const res = await fetch(api.game.history.path);
      if (!res.ok) return [];
      return await res.json();
    },
  });

  // ---------------------------
  // WebSocket connection
  // ---------------------------
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const { type, payload } = JSON.parse(event.data);

          switch (type) {
            case wsEvents.SERVER_STATE_UPDATE:
              setGameState((prev) => ({ ...prev, ...payload }));
              break;

            case wsEvents.SERVER_ROUND_START:
              setGameState({
                status: "betting",
                multiplier: 1.0,
                elapsed: 0,
                roundId: payload.roundId,
              });
              setActiveBets([]);
              break;

            case wsEvents.SERVER_ROUND_CRASH:
              setGameState((prev) => ({
                ...prev,
                status: "crashed",
                multiplier: payload.crashPoint,
                crashPoint: payload.crashPoint,
              }));
              queryClient.invalidateQueries({ queryKey: ["gameHistory"] });
              setActiveBets((prev) =>
                prev.map((pb) =>
                  pb.bet.status === "active"
                    ? { ...pb, bet: { ...pb.bet, status: "lost" } }
                    : pb,
                ),
              );
              break;

            case wsEvents.SERVER_BET_PLACED:
              setActiveBets((prev) => {
                // Replace existing bet for same slot
                const filtered = prev.filter(
                  (b) => b.playerIndex !== payload.playerIndex,
                );
                return [...filtered, payload].sort(
                  (a, b) => b.bet.amount - a.bet.amount,
                );
              });
              break;

            case wsEvents.SERVER_BET_CASHED_OUT:
              setActiveBets((prev) =>
                prev.map((pb) => (pb.bet.id === payload.bet.id ? payload : pb)),
              );
              break;

            case wsEvents.SERVER_BALANCE_UPDATE:
              queryClient.setQueryData(SLOTS_QUERY_KEY, payload.slots);
              break;
          }
        } catch (err) {
          console.error("WS parse error:", err);
        }
      };

      ws.onclose = () => {
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      wsRef.current?.close();
    };
  }, [queryClient]);

  // ---------------------------
  // Place Bet
  // ---------------------------
  const placeBetMutation = useMutation({
    mutationFn: async ({
      amount,
      autoCashout,
      playerIndex,
    }: {
      amount: number | string;
      autoCashout?: number | string | null;
      playerIndex?: number;
    }) => {
      if (playerIndex === undefined) throw new Error("playerIndex required");
      let parsedAmount = Number(amount);
      if (isNaN(parsedAmount)) parsedAmount = MIN_BET;
      parsedAmount = Math.max(MIN_BET, Math.floor(parsedAmount));

      let parsedAuto: number | null = null;
      if (autoCashout) {
        const tmp = Number(autoCashout);
        if (!isNaN(tmp) && tmp >= 1.01) parsedAuto = tmp;
      }

      const res = await fetch(api.bets.place.path, {
        method: api.bets.place.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          autoCashout: parsedAuto,
          playerIndex,
        }),
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to place bet");
      }

      return await res.json();
    },
    onError: (err: Error) => {
      toast({
        title: "Bet Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ---------------------------
  // Cashout
  // ---------------------------
  const cashoutMutation = useMutation({
    mutationFn: async (playerIndex: number) => {
      const res = await fetch(api.bets.cashout.path, {
        method: api.bets.cashout.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerIndex }),
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to cash out");
      }

      return await res.json();
    },
    onError: (err: Error) => {
      toast({
        title: "Cashout Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ---------------------------
  // Derived data
  // ---------------------------
  const myBets = useMemo(
    () => (user ? activeBets.filter((pb) => pb.user.id === user.id) : []),
    [activeBets, user],
  );

  return {
    gameState,
    activeBets,
    myBets,
    history,
    slotBalances,
    placeBet: placeBetMutation.mutateAsync,
    isPlacingBet: placeBetMutation.isPending,
    cashout: cashoutMutation.mutateAsync,
    isCashingOut: cashoutMutation.isPending,
  };
}
