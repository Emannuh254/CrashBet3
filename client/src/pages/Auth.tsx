import React, { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false); // 👈 toggle state
  const { login, register, isLoggingIn, isRegistering, user } = useAuth();
  const [, setLocation] = useLocation();

  if (user) {
    setLocation("/");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    try {
      if (isLogin) await login({ username, password });
      else await register({ username, password });
    } catch (e: any) {
      setPassword("");
    }
  };

  const isPending = isLoggingIn || isRegistering;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/20 rounded-full blur-[100px] mix-blend-screen" />
      </div>

      <div className="w-full max-w-md bg-card/80 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative z-10">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black tracking-tighter text-primary text-glow mb-2">
            CRASH<span className="text-foreground">.BET</span>
          </h1>
          <p className="text-muted-foreground text-sm">
            {isLogin
              ? "Sign in to start winning"
              : "Create an account to join the flight"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label
              htmlFor="username"
              className="text-muted-foreground uppercase text-xs font-bold tracking-wider"
            >
              Username
            </Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-background/50 border-white/10 h-12 text-lg focus-visible:ring-primary"
              placeholder="Player1"
            />
          </div>

          <div className="space-y-2 relative">
            <Label
              htmlFor="password"
              className="text-muted-foreground uppercase text-xs font-bold tracking-wider"
            >
              Password
            </Label>
            <Input
              id="password"
              type={showPassword ? "text" : "password"} // 👈 toggle type
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background/50 border-white/10 h-12 text-lg focus-visible:ring-primary pr-12"
              placeholder="••••••••"
            />
            {/* Eye button */}
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>

          <Button
            type="submit"
            disabled={isPending}
            className="w-full h-14 text-lg font-bold uppercase tracking-widest bg-primary hover:bg-primary/90 text-primary-foreground box-glow rounded-xl mt-4"
          >
            {isPending ? (
              <span className="loading-dots">Connecting</span>
            ) : isLogin ? (
              "Launch"
            ) : (
              "Register"
            )}
          </Button>
        </form>

        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {isLogin
              ? "Don't have an account? Register"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
