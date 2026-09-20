import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Zap } from "lucide-react";
import { nanoid } from "nanoid";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PhoneScanPanel } from "@/components/scan/PhoneScanPanel";
import { api } from "@/lib/api";
import type { DocumentType } from "@/types/challan";

export function ScanPage() {
  const [searchParams] = useSearchParams();
  const type = (searchParams.get("type") as DocumentType | null) ?? "incoming";
  const [sessionId] = useState(() => nanoid(12));
  const [simulating, setSimulating] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Scan Challan"
        description="Photograph the real handwritten challan with a phone — the desktop reads it by AI and auto-fills the challan. No typing."
        actions={
          <Button
            variant="outline"
            disabled={simulating}
            onClick={() => {
              setSimulating(true);
              api.scan
                .process(sessionId)
                .catch(() => {})
                .finally(() => setSimulating(false));
            }}
          >
            <Zap />
            {simulating ? "Simulating…" : "Simulate demo OCR"}
          </Button>
        }
      />

      <Card>
        <CardContent className="p-5">
          <PhoneScanPanel
            sessionId={sessionId}
            type={type}
            mode="new"
            title="Scan from your phone"
            description="Open this link on the operator's phone (same Wi-Fi), take a clear photo of the handwritten challan, and it will be read and pre-filled here automatically."
          />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        “Simulate demo OCR” runs the built-in canned extraction so you can see the pipeline without a phone or an
        API key.
      </p>
    </div>
  );
}