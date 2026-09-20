export type ActivityRecordType = "incoming_challan" | "outgoing_challan" | "invoice";

export interface ActivityEntry {
  id: string;
  type: ActivityRecordType;
  recordId: string;
  description: string;
  actor: string;
  timestamp: string;
}

export interface ActivityFeedResponse {
  items: ActivityEntry[];
}