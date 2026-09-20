import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Link2, Smartphone, ArrowRight, RefreshCw, KeyRound, Sparkles, Save, Trash2 } from "lucide-react";
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
import type { ChallanRecord } from "@/types/challan";

export function SyncPage() {
  const [status, setStatus] = useState<SyncStatusPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<ChallanRecord[]>([]);
  const [config, setConfig] = useState<GeminiConfigPayload | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keySaved, setKeySaved] = useState(false);

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