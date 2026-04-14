// Re-export from core — canonical source is now src/core/services/cwdHooks.ts
export {
  isPathOutsideCwd,
  isPathOutsideAllowed,
  isPathOutsideReadAllowed,
  isPathOutsideWriteAllowed,
  extractBashWritePaths,
  extractBashReadPaths,
  buildCwdRestrictionHooks,
} from '../../core/services/cwdHooks'
