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

  const [gameState, setGameState] = useState<GameState>({
    status: "betting",
    multiplier: 1.0,
    elapsed: 0,
  });

  const [visibleBets, setVisibleBets] = useState<PlayerBet[]>([]);

  // ─────────────────────────────────────────────
  // Initial Game State
  // ─────────────────────────────────────────────
  useQuery({
    queryKey: ["gameState"],
    queryFn: async () => {
      const res = await fetch(api.game.state.path, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch initial game state");
      const data = await res.json();
      setGameState((prev) => ({ ...prev, ...data }));
      return data;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // ─────────────────────────────────────────────
  // Slots / Balances
  // ─────────────────────────────────────────────
  const { data: slots = [] } = useQuery({
    queryKey: ["slots"],
    queryFn: async () => {
      if (!user) return [];
      const res = await fetch("/api/slots", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch slots");
      return await res.json();
    },
    refetchInterval: 4000,
    staleTime: 3000,
  });

  const slotBalances = useMemo<Record<number, number>>(() => {
    const balances: Record<number, number> = {};
    slots.forEach((slot: any, i: number) => {
      balances[i] = slot.balance ?? 0;
    });
    return balances;
  }, [slots]);

  // ─────────────────────────────────────────────
  // History
  // ─────────────────────────────────────────────
  const { data: history = [] } = useQuery({
    queryKey: ["gameHistory"],
    queryFn: async () => {
      const res = await fetch(api.game.history.path, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return await res.json();
    },
  });

  // ─────────────────────────────────────────────
  // WebSocket
  // ─────────────────────────────────────────────
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => console.log("WebSocket connected");

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
              setVisibleBets((prev) =>
                prev.filter((b) => b.bet.status !== "active"),
              );
              break;

            case wsEvents.SERVER_ROUND_CRASH:
              setGameState((prev) => ({
                ...prev,
                status: "crashed",
                multiplier: payload.crashPoint,
                crashPoint: payload.crashPoint,
              }));

              queryClient.invalidateQueries({
                queryKey: ["gameHistory"],
              });

              setVisibleBets((prev) =>
                prev.map((pb) =>
                  pb.bet.status === "active"
                    ? { ...pb, bet: { ...pb.bet, status: "lost" } }
                    : pb,
                ),
              );

              setTimeout(() => {
                setVisibleBets((prev) =>
                  prev.filter((b) => b.bet.status !== "lost"),
                );
              }, 8000);
              break;

            case wsEvents.SERVER_BET_PLACED:
              setVisibleBets((prev) => {
                const filtered = prev.filter(
                  (b) => b.playerIndex !== payload.bet?.playerIndex,
                );
                return [...filtered, payload].sort(
                  (a, b) => (b.bet.amount ?? 0) - (a.bet.amount ?? 0),
                );
              });
              break;

            case wsEvents.SERVER_BET_CASHED_OUT:
              setVisibleBets((prev) => {
                const updated = prev.map((pb) =>
                  pb.bet.id === payload.bet.id
                    ? {
                        ...pb,
                        bet: { ...pb.bet, ...payload.bet, status: "won" },
                      }
                    : pb,
                );

                return updated.filter((b) => {
                  if (b.bet.status === "lost") return false;
                  if (b.bet.status === "won") {
                    return Date.now() - (b.bet.createdAt ?? 0) < 8000;
                  }
                  return true;
                });
              });
              break;

            case wsEvents.SERVER_BALANCE_UPDATE:
              queryClient.setQueryData(["slots"], payload.slots);
              break;
          }
        } catch (err) {
          console.error("WS message parse error:", err);
        }
      };

      ws.onclose = () => {
        const delay = reconnectTimeout ? 5000 : 2000;
        reconnectTimeout = setTimeout(connect, delay);
      };

      ws.onerror = (err) => console.error("WebSocket error:", err);
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      wsRef.current?.close();
    };
  }, [queryClient]);

  // ─────────────────────────────────────────────
  const placeBetMutation = useMutation({
    mutationFn: async ({
      amount,
      autoCashout,
      playerIndex,
      queueForNext = false,
    }: {
      amount: number;
      autoCashout?: number | null;
      playerIndex: number;
      queueForNext?: boolean;
    }) => {
      // Use latest values of gameState only for logging, not for logic
      console.log("[PLACE BET REQUEST]", {
        gameStatus: gameState.status,
        queueForNext,
        slot: playerIndex,
        amount,
      });

      const res = await fetch(api.bets.place.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amount,
          autoCashout: autoCashout ?? null,
          playerIndex,
          saveNextBet: queueForNext,
        }),
      });

      if (!res.ok) {
        // Attempt to parse JSON error, fallback to generic
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to place bet");
      }

      const data = await res.json();

      // Optionally update cache immediately
      queryClient.setQueryData(["slots"], (old: any) => {
        if (!old) return old;
        return old.map((slot: any, idx: number) =>
          idx === playerIndex
            ? { ...slot, balance: (slot.balance ?? 0) - amount }
            : slot,
        );
      });

      return data;
    },
    onError: (err: Error) => {
      toast({
        title: "Bet Failed",
        description: err.message,
        variant: "destructive",
      });
    },
    onSuccess: (bet) => {
      // Invalidate relevant queries to refresh UI
      queryClient.invalidateQueries(["gameHistory"]);
      queryClient.invalidateQueries(["slots"]);
    },
  });

  // ─────────────────────────────────────────────
  // CASHOUT
  // ─────────────────────────────────────────────
  const cashoutMutation = useMutation({
    mutationFn: async (playerIndex: number) => {
      const res = await fetch(api.bets.cashout.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ playerIndex }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Cashout failed");
      }

      return res.json();
    },
    onError: (err: Error) => {
      toast({
        title: "Cashout Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const myBets = useMemo(
    () => (user ? visibleBets.filter((pb) => pb.user.id === user.id) : []),
    [visibleBets, user],
  );

  return {
    gameState,
    activeBets: visibleBets,
    myBets,
    history,
    slotBalances,
    placeBet: placeBetMutation.mutateAsync,
    isPlacingBet: placeBetMutation.isPending,
    cashout: cashoutMutation.mutateAsync,
    isCashingOut: cashoutMutation.isPending,
  };
}
