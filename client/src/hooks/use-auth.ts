import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { type InsertUser, type User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useAuth() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: user, isLoading, error } = useQuery<User | null>({
    queryKey: [api.auth.me.path],
    queryFn: async () => {
      const res = await fetch(api.auth.me.path, { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to fetch user");
      return api.auth.me.responses[200].parse(await res.json());
    },
    staleTime: Infinity,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: InsertUser) => {
      const res = await fetch(api.auth.login.path, {
        method: api.auth.login.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Login failed");
      }
      return api.auth.login.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.setQueryData([api.auth.me.path], data);
      toast({ title: "Welcome back!", description: `Logged in as ${data.username}` });
    },
    onError: (err: Error) => {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    }
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: InsertUser) => {
      const res = await fetch(api.auth.register.path, {
        method: api.auth.register.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Registration failed");
      }
      return api.auth.register.responses[201].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.setQueryData([api.auth.me.path], data);
      toast({ title: "Account created!", description: "Welcome to the game." });
    },
    onError: (err: Error) => {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.auth.logout.path, {
        method: api.auth.logout.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Logout failed");
    },
    onSuccess: () => {
      queryClient.setQueryData([api.auth.me.path], null);
      toast({ title: "Logged out", description: "See you next time." });
    },
  });

  return {
    user,
    isLoading,
    error,
    login: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    register: registerMutation.mutateAsync,
    isRegistering: registerMutation.isPending,
    logout: logoutMutation.mutateAsync,
    isLoggingOut: logoutMutation.isPending,
  };
}
