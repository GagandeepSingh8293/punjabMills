import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine, RefreshCw, Sparkles, CheckCircle2, FilePlus2, TriangleAlert } from "lucide-react";
import { nanoid } from "nanoid";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { SCAN_EVENTS, type FieldConfidence, type FieldsUpdatedPayload } from "@/types/socket-events";
import type { ChallanHeader, LineItem } from "@/types/challan";

type Stage = "idle" | "processing" | "extracted" | "error";

const STEPS = [
  { key: "processing", label: "Reading scan" },
  { key: "detected", label: "Detecting type" },
  { key: "extracted", label: "Extracting fields" },
];

export function ScanPage() {
  const navigate = useNavigate();
  const [sessionId] = useState(() => nanoid(12));
  const [stage, setStage] = useState<Stage>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [type, setType] = useState<string | null>(null);
  const [payload, setPayload] = useState<FieldsUpdatedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lowConfidence = useMemo(() => {
    if (!payload?.confidence) return 0;
    return Object.values(payload.confidence).filter((c) => c < 0.7).length;
  }, [payload]);

  const start = async () => {
    setStage("processing");
    setStepIndex(0);
    setError(null);
    setType(null);
    setPayload(null);
    try {
      await api.scan.process(sessionId);
    } catch (e) {
      setStage("error");
      setError(String(e));
    }
  };

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    let mounted = true;

    (async () => {
      try {
        const events: [string, (e: { payload: unknown }) => void][] = [
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
              setType((e.payload as { type?: string })?.type ?? "incoming");
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
              setError((e.payload as { message?: string })?.message ?? "Extraction failed");
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
      } catch {
        // ignore
      }
    })();

    return () => {
      mounted = false;
      for (const un of unlisteners) void un();
    };
  }, []);

  const countFields = (h?: Partial<ChallanHeader>) => {
    if (!h) return 0;
    let n = 0;
    for (const v of Object.values(h as object)) {
      if (v && typeof v === "object") n += Object.values(v as object).filter(Boolean).length;
      else if (v) n += 1;
    }
    return n;
  };

  const goToForm = () => navigate("/challans/new", { state: { sessionId } });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Scan Challan"
        description="Point a scanned challan document at the OCR pipeline to auto-fill the header and line items."
        actions={
          <Button onClick={start} disabled={stage === "processing"}>
            {stage === "processing" ? <RefreshCw className="animate-spin" /> : <ScanLine />}
            {stage === "idle" ? "Start Scan" : stage === "processing" ? "Scanning…" : "Rescan Document"}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="space-y-4 p-6">
              {/* Document preview */}
              <div
                className={cn(
                  "relative overflow-hidden rounded-lg border-2 border-dashed bg-gradient-to-br from-muted/60 to-muted/30 p-10 transition-colors",
                  stage === "processing" && "border-[var(--info)]"
                )}
              >
                {stage === "idle" && (
                  <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                    <ScanLine className="h-10 w-10 opacity-40" />
                    <p className="text-sm">Start a scan to simulate the OCR pipeline.</p>
                  </div>
                )}
                {stage === "processing" && (
                  <div className="py-8">
                    <div className="relative mx-auto h-56 overflow-hidden rounded border bg-white shadow-sm">
                      <div className="space-y-2 p-4 text-[10px] text-neutral-400">
                        <div className="h-3 w-1/3 rounded bg-neutral-200" />
                        <div className="h-3 w-1/2 rounded bg-neutral-100" />
                        <div className="mt-3 h-3 w-2/3 rounded bg-neutral-100" />
                        <div className="h-3 w-1/4 rounded bg-neutral-100" />
                      </div>
                      <div className="animate-scanning-line absolute left-0 right-0 h-0.5 bg-[var(--info)] shadow-[0_0_12px_var(--info)]" />
                    </div>
                  </div>
                )}
                {stage === "extracted" && payload?.header && (
                  <div className="py-2">
                    <PreviewSheet
                      header={payload.header}
                      lineItems={payload.lineItems ?? []}
                      confidence={payload.confidence}
                    />
                  </div>
                )}
                {stage === "error" && (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <TriangleAlert className="h-8 w-8 text-destructive" />
                    <p className="text-sm text-destructive">{error ?? "Extraction failed."}</p>
                  </div>
                )}
              </div>

              {/* Stage tracker */}
              <ol className="flex items-center gap-3 text-xs">
                {STEPS.map((step, i) => {
                  const active = stage === "processing" && stepIndex >= i;
                  const done = stage === "extracted" || (stage === "processing" && stepIndex > i);
                  return (
                    <li key={step.key} className="flex items-center gap-1.5">
                      {done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />
                      ) : (
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            active ? "animate-pulse bg-[var(--info)]" : "bg-muted-foreground/30"
                          )}
                        />
                      )}
                      {step.label}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          {stage === "idle" && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Demo pipeline: a canned invoice image is processed and fields are emitted over Tauri events.
            </p>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-[var(--info)]" />
                Extraction Summary
              </p>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Detected type</dt>
                  <dd className="font-medium capitalize">{type ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Header fields</dt>
                  <dd>{countFields(payload?.header)} filled</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Line items</dt>
                  <dd>{payload?.lineItems?.length ?? 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Confidence &lt; 70%</dt>
                  <dd>{lowConfidence}</dd>
                </div>
              </dl>

              <div className="pt-2">
                <Button className="w-full" onClick={goToForm} disabled={stage !== "extracted"}>
                  <FilePlus2 />
                  Create Incoming Challan
                </Button>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  You'll review and correct the extracted fields before saving; edits are logged as corrections.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PreviewSheet({
  header,
  lineItems,
  confidence,
}: {
  header: Partial<ChallanHeader>;
  lineItems: LineItem[];
  confidence?: FieldConfidence;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Extracted Header</p>
        <Badge variant="info">AI extracted</Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ConfidenceField label="Vehicle No." value={header.vehicleNo} path="header.vehicleNo" confidence={confidence} />
        <ConfidenceField label="E-Way No." value={header.eWayNo} path="header.eWayNo" confidence={confidence} />
        <ConfidenceField label="Challan Date" value={header.challanDate} path="header.challanDate" confidence={confidence} />
        <ConfidenceField label="Billing" value={header.billing?.name} path="header.billing.name" confidence={confidence} />
        <ConfidenceField label="GSTIN" value={header.billing?.gstin} path="header.billing.gstin" confidence={confidence} />
        <ConfidenceField label="Shipping" value={header.shipping?.name} path="header.shipping.name" confidence={confidence} />
      </div>

      <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Extracted Line Items ({lineItems.length})
      </p>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lot</TableHead>
              <TableHead>Particulars</TableHead>
              <TableHead>Colour</TableHead>
              <TableHead>HSN</TableHead>
              <TableHead className="text-right">Rolls</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineItems.map((item, i) => (
              <TableRow key={item.id}>
                <TableCell>{item.lotNo ?? "—"}</TableCell>
                <TableCell>{item.particulars ?? "—"}</TableCell>
                <TableCell>{item.colour ?? "—"}</TableCell>
                <TableCell>{item.hsnCode ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{item.roll ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{item.weight ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{item.rate ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ConfidenceField({
  label,
  value,
  path,
  confidence,
}: {
  label: string;
  value: string | undefined | null;
  path: string;
  confidence?: FieldConfidence;
}) {
  const conf = confidence?.[path];
  const low = conf !== undefined && conf < 0.7;
  const pct = conf !== undefined ? Math.round(conf * 100) : null;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        {pct !== null && (
          <span
            className={cn(
              "rounded-full px-1.5 text-[10px] font-medium",
              low ? "bg-destructive/10 text-destructive" : "bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]"
            )}
          >
            {pct}%
          </span>
        )}
      </p>
      <p className="truncate font-medium">{value || "—"}</p>
    </div>
  );
}