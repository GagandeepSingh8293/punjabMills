import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useUserStore } from "@/stores/user";

const DEMO_ACCOUNTS = [
  { label: "Admin", creds: "haninder@punjabdyeingmills.in" },
  { label: "Supervisor", creds: "arjun@punjabdyeingmills.in" },
  { label: "Operator", creds: "vikram@punjabdyeingmills.in" },
  { label: "Accounts", creds: "anita@punjabdyeingmills.in" },
];

export function LoginPage() {
  const navigate = useNavigate();
  const login = useUserStore((s) => s.login);
  const loading = useUserStore((s) => s.loading);
  const [identifier, setIdentifier] = useState("haninder@punjabdyeingmills.in");
  const [password, setPassword] = useState("Password123!");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const user = await login(identifier, password);
      if (user.role === "Admin") navigate("/", { replace: true });
      else navigate("/", { replace: true });
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#14151d] via-[#1c1f3a] to-[#14151d] px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#8891d9]/20 text-[#8891d9]">
            <Package className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-white">DyeAI</h1>
            <p className="text-sm text-white/60">Punjab Dyeing Mills · Job Work Suite</p>
          </div>
        </div>

        <Card className="border-white/10 bg-white/95 shadow-2xl">
          <CardContent className="pt-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="identifier">Email or phone</Label>
                <Input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@punjabdyeingmills.in"
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  Invalid credentials. Try a demo account below.
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Spinner size={16} />}
                Sign in
              </Button>
            </form>

            <div className="mt-6 rounded-lg border bg-muted/60 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Demo accounts · Password: Password123!
              </p>
              <ul className="space-y-1">
                {DEMO_ACCOUNTS.map((acc) => (
                  <li key={acc.label} className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => setIdentifier(acc.creds)}
                    >
                      {acc.label}
                    </button>
                    <span className="text-muted-foreground">{acc.creds}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}