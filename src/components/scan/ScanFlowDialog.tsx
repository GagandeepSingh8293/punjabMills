import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PhoneScanPanel } from "@/components/scan/PhoneScanPanel";
import type { DocumentType } from "@/types/challan";

/**
 * Modal wrapper around PhoneScanPanel, opened from the incoming challan list
 * (per-row + "Scan" header action) and the New Challan form.
 */
export function ScanFlowDialog({
  open,
  onOpenChange,
  mode,
  existingId,
  type = "incoming",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "new" | "existing";
  existingId?: string;
  type?: DocumentType;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "existing" ? "Scan photo for this challan" : "Scan a new incoming challan"}
          </DialogTitle>
          <DialogDescription>
            Photograph the handwritten challan with the phone — the data lands in the desktop app automatically.
          </DialogDescription>
        </DialogHeader>
        <PhoneScanPanel
          mode={mode}
          existingId={existingId}
          type={type}
          title="Scan from your phone"
          description="Open this link on the operator's phone (same Wi-Fi), take a clear photo of the challan, and the fields below will fill in by themselves."
        />
      </DialogContent>
    </Dialog>
  );
}