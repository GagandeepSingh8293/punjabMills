/** A single `.dyeai` encrypted backup file on disk. */
export type BackupEntry = {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
};

export type BackupSecurityStatus = {
  encrypted: boolean;
  keySource: "keyring" | "file";
  dbPath: string;
  backupsDir: string;
  lastBackup: BackupEntry | null;
};

export type BackupCreated = {
  ok: boolean;
  path: string;
  size: number;
  sha256: string;
  createdAt: string;
  encrypted: boolean;
};

export type BackupRestored = {
  ok: boolean;
  requiresRestart: boolean;
  restoredFrom: string;
};