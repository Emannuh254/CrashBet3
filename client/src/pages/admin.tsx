import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { User } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Coins, UserCircle, Trash2 } from "lucide-react";

export default function AdminPage() {
  const { toast } = useToast();
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
  });

  const setBalanceMutation = useMutation({
    mutationFn: async ({
      userId,
      balance,
      playerIndex,
    }: {
      userId: number;
      balance: number;
      playerIndex: number;
    }) => {
      await apiRequest("POST", "/api/admin/set-balance", {
        userId,
        balance,
        playerIndex,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Balance updated" });
    },
    onError: (e: Error) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin" />
      </div>
    );

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-3xl font-black mb-8 text-white tracking-tighter">
        ADMIN <span className="text-primary">PANEL</span>
      </h1>

      <div className="grid gap-4">
        {users?.map((user) => (
          <Card key={user.id} className="bg-zinc-900/50 border-zinc-800">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <UserCircle className="w-8 h-8 text-zinc-600" />
                <div>
                  <div className="font-bold text-white">{user.username}</div>
                  <div className="text-xs text-zinc-500">
                    ID: {user.id} {user.isAdmin && "• ADMIN"}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-4">
              {[0, 1, 2, 3, 4].map((slotIdx) => (
                <div key={slotIdx} className="space-y-2">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase">
                    Slot {slotIdx + 1}
                  </div>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={inputs[`${user.id}-${slotIdx}`] || ""}
                    onChange={(e) =>
                      setInputs({
                        ...inputs,
                        [`${user.id}-${slotIdx}`]: e.target.value,
                      })
                    }
                    className="bg-zinc-950 border-zinc-800 h-8 text-xs font-mono"
                  />
                  <Button
                    onClick={() => {
                      const val = parseFloat(inputs[`${user.id}-${slotIdx}`]);
                      if (isNaN(val)) return;
                      setBalanceMutation.mutate({
                        userId: user.id,
                        balance: val,
                        playerIndex: slotIdx,
                      });
                    }}
                    disabled={setBalanceMutation.isPending}
                    className="w-full bg-primary hover:bg-primary/90 h-7 font-bold uppercase text-[10px]"
                  >
                    Set
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
