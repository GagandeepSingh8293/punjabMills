import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Link2, Smartphone, ArrowRight, RefreshCw, KeyRound, Sparkles, Save, Trash2, Cloud, CloudOff, Unplug, Wifi, WifiOff, Loader2 } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { SYNC_EVENTS, type GeminiConfigPayload, type SyncStatusPayload, type SyncedChallanPayload } from "@/types/socket-events";
import { useCloudSyncStore } from "@/stores/cloud-sync";
import type { ChallanRecord } from "@/types/challan";

function formatWhen(iso?: string): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export function SyncPage() {
  const [status, setStatus] = useState<SyncStatusPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<ChallanRecord[]>([]);
  const [config, setConfig] = useState<GeminiConfigPayload | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);

  const cloud = useCloudSyncStore();
  const [remoteUrl, setRemoteUrl] = useState("http://127.0.0.1:8000");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [justSynced, setJustSynced] = useState(false);

  const pendingTotal =
    (cloud.status?.pending?.challans ?? 0) +
    Object.values(cloud.status?.pending?.masters ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const login = await fetch(`${remoteUrl.replace(/\/$/, "")}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (!login.ok) {
        const body = await login.json().catch(() => ({}));
        throw new Error((body as { detail?: string }).detail ?? `Login failed (${login.status})`);
      }
      const data = (await login.json()) as { access_token: string };
      await api.cloud.configure(remoteUrl, data.access_token);
      await cloud.refresh();
    } catch (e) {
      setConnectError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    let mounted = true;

    api.sync
      .status()
      .then((s) => mounted && setStatus(s))
      .catch(() => mounted && setStatus({ running: false, error: "Could not reach the sync server." }));
    api.sync.config().then((c) => mounted && setConfig(c)).catch(() => mounted && setConfig({ configured: false, model: "" }));

    (async () => {
      const events: [string, (e: { payload: unknown }) => void][] = [
        [
          SYNC_EVENTS.STATUS,
          (e) => {
            if (!mounted) return;
            setStatus(e.payload as SyncStatusPayload);
          },
        ],
        [
          SYNC_EVENTS.CHALLAN_SYNCED,
          (e) => {
            if (!mounted) return;
            const record = e.payload as SyncedChallanPayload;
            setRecent((prev) => [record, ...prev].slice(0, 8));
          },
        ],
      ];
      for (const [event, handler] of events) {
        try {
          const unlisten = await listen(event, handler);
          unlisteners.push(unlisten);
        } catch {
          // Running in a plain browser (npm run dev) — no Tauri runtime.
        }
      }
    })();

    void useCloudSyncStore.getState().refresh();

    return () => {
      mounted = false;
      for (const un of unlisteners) void un();
    };
  }, []);

  const url = status?.url ?? "";
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const qrValue = useMemo(() => url || "http://localhost", [url]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Sync from Phone"
        description="Open the link (or scan the QR) on any phone on the same Wi-Fi to submit challans straight into this desktop app."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void api.sync.status().then(setStatus);
              void api.sync.config().then(setConfig);
            }}
          >
            <RefreshCw />
            Refresh
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="h-4 w-4" />
            Cloud backup & sync
            <Badge variant={cloud.status?.configured ? (cloud.status.online ? "success" : "warning") : "secondary"}>
              {cloud.status?.configured ? (cloud.status.online ? "Online" : "Offline") : "Not configured"}
            </Badge>
            {cloud.status?.syncing && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Syncing…
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Keeps a copy of challans, customers and masters on the server — offline-first, so you can work
            anywhere and it catches up automatically every 30 seconds when back online.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cloud.status?.configured ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Last sync</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                    {cloud.status.online ? <Wifi className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <WifiOff className="h-4 w-4 text-muted-foreground" />}
                    {formatWhen(cloud.status.lastSyncedAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {cloud.status.lastMode === "auto" ? "automatic" : "manual"}
                    {cloud.status.lastError ? ` · error: ${cloud.status.lastError}` : ""}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Pending changes</p>
                  <p className="mt-1 text-sm font-medium">
                    {pendingTotal === 0 ? (
                      <span className="text-emerald-600 dark:text-emerald-400">All synced</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">{pendingTotal} to upload</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(cloud.status?.pending?.challans ?? 0) > 0 && (
                      <span>{cloud.status?.pending?.challans} challans</span>
                    )}
                    {Object.entries(cloud.status?.pending?.masters ?? {})
                      .filter(([, n]) => (n ?? 0) > 0)
                      .map(([k, n]) => (
                        <span key={k} className="capitalize">
                          {k === "hsnCodes" ? "HSN codes" : k} {n}
                          ·{" "}
                        </span>
                      ))}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Device</p>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{cloud.status.deviceId ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{cloud.status.remoteUrl}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  disabled={cloud.status.syncing}
                  onClick={() => {
                    void cloud.syncNow().then(() => {
                      setJustSynced(true);
                      setTimeout(() => setJustSynced(false), 2000);
                    });
                  }}
                >
                  {cloud.status.syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {justSynced ? "Synced" : "Sync now"}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await api.cloud.configure("", "");
                    await cloud.refresh();
                  }}
                >
                  <Unplug className="h-4 w-4" />
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Label htmlFor="cloud-url">Server URL</Label>
                    <Input
                      id="cloud-url"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="http://127.0.0.1:8000"
                    />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="cloud-email">Account email</Label>
                    <Input id="cloud-email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} autoComplete="email" />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="cloud-pass">Password</Label>
                    <Input id="cloud-pass" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" />
                  </div>
                </div>
                <Button onClick={() => void connect()} disabled={connecting || !remoteUrl.trim() || !loginEmail.trim() || !loginPassword.trim()}>
                  {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                  {connecting ? "Connecting…" : "Connect"}
                </Button>
                {connectError && <p className="text-sm text-destructive">{connectError}</p>}
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Not configured yet — everything stays on this device until you connect a server.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="h-4 w-4" />
              Link for your phone
            </CardTitle>
            <CardDescription>
              Keep both devices on the same network. The desktop app hosts a small local server (port{" "}
              {status?.port ?? 3784}) — no internet, no account needed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {status?.running === false ? (
              <p className="text-sm text-destructive">{status.error ?? "Sync server is not running."}</p>
            ) : (
              <>
                <div className="rounded-xl border bg-white p-4">
                  <QRCodeSVG value={qrValue} size={172} level="M" />
                </div>
                <div className="flex w-full items-center gap-2 rounded-lg bg-muted/40 p-3">
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <code className="min-w-0 flex-1 truncate text-sm">{url || "…"}</code>
                  <Button size="sm" variant="outline" onClick={copyUrl} disabled={!url}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                {status?.ip && <p className="text-xs text-muted-foreground">LAN IP: {status.ip}</p>}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How it works</CardTitle>
            <CardDescription>No app install — the capture page runs in any phone browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Open the link (or scan the QR) on the operator&apos;s phone.</li>
              <li>Fill the challan — party, vehicle, and line items.</li>
              <li>Tap <span className="font-medium text-foreground">Sync challan</span>.</li>
              <li>It lands in this app instantly — check the list or Dashboard.</li>
            </ol>
            <Separator />
            <div>
              <p className="mb-2 text-sm font-medium">In this session</p>
              {recent.length === 0 ? (
                <EmptyState note="Nothing synced yet. Send one from your phone to see it here." />
              ) : (
                <ul className="space-y-2">
                  {recent.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`/challans/${c.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {c.header.challanNo} — {c.header.billing?.name ?? "—"}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {c.documentType === "outgoing" ? "Outgoing" : "Incoming"} · {c.header.vehicleNo || "no vehicle"}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Scan AI
            <Badge variant={config?.configured ? "success" : "warning"}>
              {config?.configured ? "Configured" : "Key needed"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Handwritten challan photos are read on this machine with Google Gemini — model{" "}
            {config?.model || "…"}. Add a free API key so phone scans can extract fields. The key stays on this
            device.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="gemini-key">Gemini API key</Label>
              <Input
                id="gemini-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeySaved(false);
                }}
                placeholder={config?.configured ? "•••••••••• (already set — type to replace)" : "Paste your key…"}
              />
            </div>
            <Button
              onClick={() => {
                void api.sync.setApiKey(apiKey.trim()).then(() => {
                  api.sync.config().then(setConfig).catch(() => {});
                  setApiKey("");
                  setKeySaved(true);
                  setTimeout(() => setKeySaved(false), 2500);
                });
              }}
              disabled={!apiKey.trim()}
            >
              {keySaved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {keySaved ? "Saved" : "Save key"}
            </Button>
            {config?.configured && (
              <Button
                variant="outline"
                onClick={() => {
                  void api.sync.setApiKey("").then(() => api.sync.config().then(setConfig).catch(() => {}));
                }}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Create a key at <span className="font-medium">aistudio.google.com/apikey</span> — photos are sent to
            Google only while scanning.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <Badge variant="info">Demo-ready</Badge>
          <span className="text-muted-foreground">
            On Windows, allow the firewall prompt the first time the app runs. Anyone on your LAN can submit a
            challan until real authentication is added.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ note }: { note: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{note}</p>;
}