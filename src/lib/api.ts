import { invoke } from "@tauri-apps/api/core";
import type { ChallanListResponse, ChallanRecord } from "@/types/challan";
import type { Invoice, InvoiceListResponse } from "@/types/billing";
import type { User } from "@/types/user";
import type { TenantSettings } from "@/types/tenant";
import type { JobWorkSettings, InvoiceNumberingSettings, MasterRecord, MasterType } from "@/types/masters";
import type { DashboardStatsResponse } from "@/types/dashboard";
import type { ActivityFeedResponse } from "@/types/activity";
import type { GlobalSearchResponse } from "@/types/search";
import type { ChallanFilterOptions } from "@/types/api";
import type { SyncStatusPayload, GeminiConfigPayload, GstConfigPayload, ScanPhotoPayload } from "@/types/socket-events";

export interface GstLookupResult {
  found: boolean;
  source: "local" | "online" | "none";
  customer?: { name: string; gstin: string; address: string; state: string; stateCode: string };
  message?: string;
}

export interface BulkInvoiceResult {
  created: number;
  invoices: Invoice[];
}

function err(message: unknown): Error {
  return new Error(String(message));
}

export const api = {
  auth: {
    login: (identifier: string, password: string): Promise<User> =>
      invoke<User>("login", { identifier, password }).catch((e) => Promise.reject(err(e))),
    getUser: (userId: string): Promise<User | null> =>
      invoke<User | null>("get_user", { userId }).catch((e) => Promise.reject(err(e))),
    updateProfile: (userId: string, payload: { name: string; email: string; phone: string }): Promise<User> =>
      invoke<User>("update_profile", { userId, payload }).catch((e) => Promise.reject(err(e))),
    updateAvatar: (userId: string, avatarUrl: string | null): Promise<User> =>
      invoke<User>("update_avatar", { userId, avatarUrl }).catch((e) => Promise.reject(err(e))),
    changePassword: (userId: string, currentPassword: string, newPassword: string): Promise<boolean> =>
      invoke<boolean>("change_password", { userId, currentPassword, newPassword }).catch((e) =>
        Promise.reject(err(e))
      ),
  },

  masters: {
    list: (kind: string): Promise<MasterRecord[]> =>
      invoke<MasterRecord[]>("list_masters", { kind }).catch((e) => Promise.reject(err(e))),
    create: (kind: MasterType, payload: Record<string, unknown>): Promise<MasterRecord> =>
      invoke<MasterRecord>("create_master", { kind, payload }).catch((e) => Promise.reject(err(e))),
    update: (kind: MasterType, id: string, payload: Record<string, unknown>): Promise<MasterRecord> =>
      invoke<MasterRecord>("update_master", { kind, id, payload }).catch((e) => Promise.reject(err(e))),
  },

  settings: {
    tenant: {
      get: (): Promise<TenantSettings | null> =>
        invoke<TenantSettings | null>("get_tenant_settings").catch((e) => Promise.reject(err(e))),
      save: (payload: TenantSettings): Promise<TenantSettings> =>
        invoke<TenantSettings>("save_tenant_settings", { payload }).catch((e) => Promise.reject(err(e))),
    },
    jobWork: {
      get: (): Promise<JobWorkSettings> =>
        invoke<JobWorkSettings>("get_job_work_settings").catch((e) => Promise.reject(err(e))),
      save: (payload: JobWorkSettings): Promise<JobWorkSettings> =>
        invoke<JobWorkSettings>("save_job_work_settings", { payload }).catch((e) => Promise.reject(err(e))),
    },
    invoiceNumbering: {
      get: (): Promise<InvoiceNumberingSettings> =>
        invoke<InvoiceNumberingSettings>("get_invoice_numbering_settings").catch((e) => Promise.reject(err(e))),
      save: (payload: InvoiceNumberingSettings): Promise<InvoiceNumberingSettings> =>
        invoke<InvoiceNumberingSettings>("save_invoice_numbering_settings", { payload }).catch((e) =>
          Promise.reject(err(e))
        ),
    },
  },

  challans: {
    list: (filters: Record<string, unknown>): Promise<ChallanListResponse> =>
      invoke<ChallanListResponse>("list_challans", { filters }).catch((e) => Promise.reject(err(e))),
    get: (id: string): Promise<ChallanRecord> =>
      invoke<ChallanRecord>("get_challan", { id }).catch((e) => Promise.reject(err(e))),
    create: (payload: Record<string, unknown>, sessionId?: string): Promise<ChallanRecord> =>
      invoke<ChallanRecord>("create_challan", { payload, sessionId }).catch((e) => Promise.reject(err(e))),
    update: (id: string, payload: Record<string, unknown>, sessionId?: string): Promise<ChallanRecord> =>
      invoke<ChallanRecord>("update_challan", { id, payload, sessionId }).catch((e) => Promise.reject(err(e))),
    filterOptions: (documentType?: string): Promise<ChallanFilterOptions> =>
      invoke<ChallanFilterOptions>("get_challan_filter_options", { documentType }).catch((e) =>
        Promise.reject(err(e))
      ),
  },

  invoices: {
    list: (params: { q?: string; status?: string; page?: number; pageSize?: number }): Promise<InvoiceListResponse> =>
      invoke<InvoiceListResponse>("list_invoices", params).catch((e) => Promise.reject(err(e))),
    get: (id: string): Promise<Invoice> =>
      invoke<Invoice>("get_invoice", { id }).catch((e) => Promise.reject(err(e))),
    generate: (challanIds: string[]): Promise<BulkInvoiceResult> =>
      invoke<BulkInvoiceResult>("generate_invoices", { challanIds }).catch((e) => Promise.reject(err(e))),
    updateStatus: (id: string, status: string): Promise<Invoice> =>
      invoke<Invoice>("update_invoice_status", { id, status }).catch((e) => Promise.reject(err(e))),
    updateDetails: (id: string, payload: Record<string, unknown>): Promise<Invoice> =>
      invoke<Invoice>("update_invoice_details", { id, payload }).catch((e) => Promise.reject(err(e))),
  },

  gst: {
    lookup: (gstin: string): Promise<GstLookupResult> =>
      invoke<GstLookupResult>("lookup_gst", { gstin }).catch((e) => Promise.reject(err(e))),
    config: (): Promise<GstConfigPayload> =>
      invoke<GstConfigPayload>("get_gst_config").catch((e) => Promise.reject(err(e))),
    setApiKey: (key: string): Promise<void> =>
      invoke<void>("set_gst_api_key", { key }).catch((e) => Promise.reject(err(e))),
  },

  dashboard: {
    stats: (): Promise<DashboardStatsResponse> =>
      invoke<DashboardStatsResponse>("get_dashboard_stats").catch((e) => Promise.reject(err(e))),
    activity: (limit?: number): Promise<ActivityFeedResponse> =>
      invoke<ActivityFeedResponse>("get_activity_feed", { limit }).catch((e) => Promise.reject(err(e))),
  },

  search: {
    global: (q: string): Promise<GlobalSearchResponse> =>
      invoke<GlobalSearchResponse>("global_search", { q }).catch((e) => Promise.reject(err(e))),
  },

  scan: {
    process: (sessionId: string): Promise<void> =>
      invoke<void>("process_scan_capture", { sessionId }).catch((e) => Promise.reject(err(e))),
    getExtraction: (sessionId: string): Promise<unknown | null> =>
      invoke<unknown | null>("get_scan_extraction", { sessionId }).catch(() => null),
    photo: (photoId: string): Promise<ScanPhotoPayload | null> =>
      invoke<ScanPhotoPayload | null>("get_scan_photo", { photoId }).catch(() => null),
  },

  sync: {
    status: (): Promise<SyncStatusPayload> =>
      invoke<SyncStatusPayload>("get_sync_status").catch((e) => Promise.reject(err(e))),
    config: (): Promise<GeminiConfigPayload> =>
      invoke<GeminiConfigPayload>("get_gemini_config").catch((e) => Promise.reject(err(e))),
    setApiKey: (key: string): Promise<void> =>
      invoke<void>("set_gemini_api_key", { key }).catch((e) => Promise.reject(err(e))),
  },
};