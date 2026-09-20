import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Smartphone, Sparkles, TriangleAlert, FilePlus2, Link2, ScanLine } from "lucide-react";
import { nanoid } from "nanoid";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  SCAN_EVENTS,
  type FieldConfidence,
  type FieldsUpdatedPayload,
  type GeminiConfigPayload,
  type ScanPhotoPayload,
  type ScanPhotoReceivedPayload,
  type SyncStatusPayload,
} from "@/types/socket-events";
import type { ChallanHeader, DocumentType, LineItem } from "@/types/challan";

type Stage = "idle" | "waiting" | "processing" | "extracted" | "error";
type Mode = "new" | "existing";

const STEPS = [
  { key: "processing", label: "Reading scan" },
  { key: "detected", label: "Detecting type" },
  { key: "extracted", label: "Extracting fields" },
];

/**
 * Live "scan a real challan photo from your phone" panel. Shows the phone QR/link,
 * previews the captured photo as it lands, and reflects the Gemini pipeline events.
 * Used inline on the Scan page and inside ScanFlowDialog (challan list + form).
 */
export function PhoneScanPanel({
  sessionId: fixedSession,
  type = "incoming",
  mode = "new",
  existingId,
  title = "Scan with your phone",
  description = "Open this link (or scan the QR) on a phone on the same Wi-Fi. When the operator photographs the handwritten challan, it is read here automatically.",
}: {
  sessionId?: string;
  type?: DocumentType;
  mode?: Mode;
  existingId?: string;
  title?: string;
  description?: string;
}) {
  const navigate = useNavigate();
  const [sessionId] = useState(() => fixedSession ?? nanoid(12));
  const [status, setStatus] = useState<SyncStatusPayload | null>(null);
  const [config, setConfig] = useState<GeminiConfigPayload | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [detectedType, setDetectedType] = useState<string | null>(null);
  const [payload, setPayload] = useState<FieldsUpdatedPayload | null>(null);
  const [photo, setPhoto] = useState<ScanPhotoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url = status?.url ?? "";
  const scanUrl = useMemo(() => (url ? `${url}/scan?session=${sessionId}&type=${type}` : ""), [url, sessionId, type]);

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    let mounted = true;

    api.sync.status().then(setStatus).catch(() => setStatus({ running: false, error: "Sync server unreachable." }));
    api.sync.config().then(setConfig).catch(() => setConfig({ configured: false, model: "" }));

    (async () => {
      const events: [string, (e: { payload: unknown }) => void][] = [
        [
          SCAN_EVENTS.PHOTO_RECEIVED,
          (e) => {
            if (!mounted) return;
            const rec = e.payload as ScanPhotoReceivedPayload;
            if (rec.sessionId && rec.sessionId !== sessionId) return;
            setError(null);
            setStage("waiting");
            api.scan.photo(rec.photoId).then((p) => mounted && p && setPhoto(p)).catch(() => {});
          },
        ],
        [
          SCAN_EVENTS.PROCESSING,
          () => {
            if (!mounted) return;
            setStage("processing");
          },
        ],
        [
          SCAN_EVENTS.TYPE_DETECTED,
          (e) => {
            if (!mounted) return;
            setDetectedType((e.payload as { type?: string })?.type ?? null);
            setStepIndex(1);
          },
        ],
        [
          SCAN_EVENTS.FIELDS_UPDATED,
          (e) => {
            if (!mounted) return;
            setPayload(e.payload as FieldsUpdatedPayload);
            setStepIndex(2);
            setStage("extracted");
          },
        ],
        [
          SCAN_EVENTS.EXTRACTION_FAILED,
          (e) => {
            if (!mounted) return;
            setStage("error");
            setError((e.payload as { message?: string })?.message ?? "Extraction failed.");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(scanUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const lowConfidence = payload?.confidence ? Object.values(payload.confidence).filter((c) => c < 0.7).length : 0;
  const needsKey = config !== null && !config.configured;
  const goToForm = () => {
    if (mode === "existing" && existingId) {
      navigate(`/challans/${existingId}?session=${sessionId}`, { state: { sessionId } });
    } else {
      navigate(`/challans/new?type=${type}&session=${sessionId}`, { state: { sessionId } });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 p-5 text-center">
        {stage === "idle" || stage === "waiting" ? (
          <>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Smartphone className="h-4 w-4" />
              {title}
            </p>
            <p className="max-w-md text-xs text-muted-foreground">{description}</p>
            {status?.running === false ? (
              <p className="text-sm text-destructive">{status.error ?? "Sync server is not running."}</p>
            ) : scanUrl ? (
              <div className="mt-2 space-y-3">
                <div className="rounded-xl border bg-white p-3">
                  <QRCodeSVG value={scanUrl} size={150} level="M" />
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-background p-2">
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <code className="min-w-0 flex-1 truncate text-xs">{scanUrl}</code>
                  <Button size="sm" variant="outline" onClick={copyUrl}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                {needsKey && (
                  <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    Add a Gemini API key first under <Link to="/sync" className="font-medium underline">Sync → Scan AI</Link> or the photo can&apos;t be read.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Waiting for the sync server…</p>
            )}
          </>
        ) : stage === "processing" ? (
          <>
            <ScanLine className="h-8 w-8 animate-pulse text-[var(--info)]" />
            <p className="text-sm font-medium">Processing the photo…</p>
            <p className="text-xs text-muted-foreground">The desktop app is reading the challan with AI. The form will pre-fill here automatically.</p>
          </>
        ) : null}

        {stage === "extracted" && payload && (
          <div className="w-full text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">AI extracted</Badge>
              <span className="text-xs text-muted-foreground capitalize">
                {detectedType ?? "incoming"} challan
              </span>
              {photo && <span className="text-[11px] text-muted-foreground">Photo captured</span>}
            </div>
            <ExtractionSummary header={payload.header} lineItems={payload.lineItems ?? []} confidence={payload.confidence} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={goToForm}>
                <FilePlus2 />
                {mode === "existing" ? "Review & apply to this challan" : "Review in New Challan form"}
              </Button>
              <p className="w-full text-xs text-muted-foreground md:w-auto md:self-center">
                You confirm the extracted fields; your edits are logged as corrections.
              </p>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="flex flex-col items-center gap-2 text-center">
            <TriangleAlert className="h-7 w-7 text-destructive" />
            <p className="text-sm text-destructive">{error ?? "Extraction failed."}</p>
            <p className="text-xs text-muted-foreground">Have the operator retake a clearer, flatter photo in good light, then try again.</p>
          </div>
        )}
      </div>

      {photo && (
        <Card>
          <CardContent className="flex items-start gap-4 p-4">
            <img src={photo.dataUrl} alt="Captured challan" className="h-32 w-24 rounded-md border object-cover" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">Captured photo</p>
              <p className="text-xs text-muted-foreground">
                {Math.round(photo.size / 102.4) / 10} KB · {photo.mime}
              </p>
              <p className="text-xs text-muted-foreground">
                Saved automatically and attached to the challan when you save it.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {stage !== "idle" && stage !== "waiting" && (
        <ol className="flex items-center gap-3 text-xs">
          {STEPS.map((step, i) => {
            const active = stage === "processing" && stepIndex >= i;
            const done = stage === "extracted" || (stage === "processing" && stepIndex > i);
            return (
              <li key={step.key} className="flex items-center gap-1.5">
                {done ? (
                  <span className="text-[var(--success)]">✓</span>
                ) : (
                  <span className={cn("h-2 w-2 rounded-full", active ? "animate-pulse bg-[var(--info)]" : "bg-muted-foreground/30")} />
                )}
                {step.label}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ExtractionSummary({
  header,
  lineItems,
  confidence,
}: {
  header?: Partial<ChallanHeader>;
  lineItems: LineItem[];
  confidence?: FieldConfidence;
}) {
  const fields = [
    { label: "Party", value: header?.billing?.name },
    { label: "Vehicle", value: header?.vehicleNo },
    { label: "Date", value: header?.challanDate },
    { label: "GSTIN", value: header?.billing?.gstin },
  ];
  const filled = fields.filter((f) => f.value).length;
  const low = confidence ? Object.values(confidence).filter((c) => c < 0.7).length : 0;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border bg-background p-3 text-sm sm:grid-cols-4">
      <div>
        <dt className="text-xs text-muted-foreground">Header</dt>
        <dd className="font-medium">{filled} of {fields.length} fields</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Line items</dt>
        <dd className="font-medium">{lineItems.length}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Confidence &lt; 70%</dt>
        <dd className="font-medium">{low}</dd>
      </div>
      <div>
        <dt className="flex items-center gap-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3" /> Status
        </dt>
        <dd className="font-medium text-[var(--success)]">Ready to review</dd>
      </div>
    </dl>
  );
}