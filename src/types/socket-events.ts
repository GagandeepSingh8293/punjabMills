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
  PHOTO_RECEIVED: "challan:photo-received",
  HEARTBEAT: "challan:heartbeat",
} as const;

/** Emitted when a photo lands in the desktop app from the phone capture page. */
export type ScanPhotoReceivedPayload = {
  sessionId: string;
  photoId: string;
  mime: string;
  size: number;
  createdAt: string;
};

/** Full base64-decodable photo returned by `get_scan_photo`. */
export type ScanPhotoPayload = {
  photoId: string;
  mime: string;
  size: number;
  createdAt: string;
  dataUrl: string;
};

/** Result of `get_gemini_config`. */
export type GeminiConfigPayload = {
  configured: boolean;
  model: string;
};

/** Result of `get_gst_config`. */
export type GstConfigPayload = {
  configured: boolean;
  provider: string;
};

/** Emitted when a challan is received from the phone-over-LAN sync server. */
export const SYNC_EVENTS = {
  CHALLAN_SYNCED: "challan:synced",
  STATUS: "sync:status",
} as const;

export type SyncStatusPayload = {
  running: boolean;
  port?: number;
  url?: string;
  ip?: string;
  error?: string;
};

export type SyncedChallanPayload = import("./challan").ChallanRecord;