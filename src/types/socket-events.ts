import type { ChallanHeader, DocumentType, LineItem } from "@/types/challan";

/** Dot-path (e.g. "header.billing.name", "lineItems.0.colour") -> AI confidence, 0-1. */
export type FieldConfidence = Record<string, number>;

export type FieldsUpdatedPayload = {
  header?: Partial<ChallanHeader>;
  lineItems?: LineItem[];
  /** Present when this patch came from AI OCR extraction — see #101. */
  confidence?: FieldConfidence;
};

export type TypeDetectedPayload = {
  type: DocumentType;
};

export type ExtractionFailedPayload = {
  message: string;
};

/** Tauri events emitted by the Rust scan pipeline (replaces the Socket.io contract). */
export const SCAN_EVENTS = {
  PROCESSING: "challan:processing",
  TYPE_DETECTED: "challan:type-detected",
  FIELDS_UPDATED: "challan:fields-updated",
  EXTRACTION_FAILED: "challan:extraction-failed",
  HEARTBEAT: "challan:heartbeat",
} as const;