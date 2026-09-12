export interface PortInfo {
  port: number;
  proto: 'tcp' | 'udp';
  label: string;
}

export interface BackupItem {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string | null;
}

export interface BackupSummary {
  count: number;
  latest: BackupItem | null;
}

export interface GameStatus {
  id: string;
  kind: 'builtin' | 'steam';
  label: string;
  unit: string;
  manager: string;
  installed: boolean;
  serviceExists: boolean;
  managerExists: boolean;
  active: string;
  sub: string;
  mainPID: number;
  memoryCurrent: number | null;
  memoryPeak: number | null;
  memoryMax: number | null;
  cpuPercent: number | null;
  since: string | null;
  ports: PortInfo[];
  configEditable: boolean;
  configPath: string | null;
  backupDir: string;
  backupPrefix: string;
  lastBackup: BackupSummary;
  installScript: string;
}

export interface InstallField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'password' | 'select' | 'bool';
  required: boolean;
  defaultValue: string;
  pattern: string;
  maxLength: number;
  secret: boolean;
  help: string;
  options?: { value: string; label: string }[];
}

export interface InstallEntry {
  gameId: string;
  label: string;
  kind: 'builtin' | 'steam';
  script: string;
  slug: string | null;
  description: string;
  fields: InstallField[];
  defaultPort: number | null;
}

export interface TaskSnapshot {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  gameId: string | null;
  status: 'running' | 'success' | 'failed' | 'interrupted';
  createdAt: number;
  endedAt: number | null;
  exitCode: number | null;
  output: string;
  truncated: boolean;
}

export interface ScheduleItem {
  id: string;
  calendar: string;
  nextElapse: string | null;
  command: string;
  stale: boolean;
}

export interface UninstallPreview {
  gameId: string;
  label: string;
  confirmName: string;
  units: string[];
  files: string[];
  dirs: string[];
  users: string[];
  script: string;
}

export interface AuditRow {
  time: string;
  game: string;
  user: string;
  action: string;
  detail: string;
  raw: string;
}

export interface ConfigApplyResult {
  status: 'applied' | 'rolled_back' | 'unchanged' | 'no_change_detected';
  output: string;
  problemConfigPath: string | null;
  preChangeBackupPath: string | null;
  exitCode: number | null;
}
