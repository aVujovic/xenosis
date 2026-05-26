import type { WorkspaceConfig } from './workspace';

/** Resolved-once context every tool receives. */
export interface WorkspaceContext {
  /** Absolute workspace root (directory holding xenosis.workspace.json). */
  root: string;
  config: WorkspaceConfig;
}
