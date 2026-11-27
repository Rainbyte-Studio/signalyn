/**
 * Signalyn Centralized Permission System (Phase 5S-D2-D.2)
 * 
 * Provides consistent role-based access control (RBAC):
 * - GUEST (Read-Only): Cannot trigger collection, Gemini analysis, backfills,
 *   or mutations. Administrative buttons and privileged management workflows are hidden.
 * - ADMIN (Full Access): Authenticated and verified via Firebase Admin registry / custom claims.
 * 
 * Strict Fail-Closed: Defaults to false while authentication or admin role is resolving.
 */

import { useApp } from '../context/AppContext';

export interface UserPermissions {
  isAdmin: boolean;
  canManage: boolean;
  canCollect: boolean;
  canAnalyze: boolean;
  canManageSources: boolean;
  canManageGroups: boolean;
  canManageEntities: boolean;
  canManageSettings: boolean;
  canRunMaintenance: boolean;
  isAuthResolving: boolean;
}

export function usePermissions(): UserPermissions {
  const { isAdmin, isAuthLoading, isCheckingAdmin } = useApp();
  const isAuthResolving = Boolean(isAuthLoading || isCheckingAdmin);
  const effectiveAdmin = Boolean(!isAuthResolving && isAdmin);

  return {
    isAdmin: effectiveAdmin,
    canManage: effectiveAdmin,
    canCollect: effectiveAdmin,
    canAnalyze: effectiveAdmin,
    canManageSources: effectiveAdmin,
    canManageGroups: effectiveAdmin,
    canManageEntities: effectiveAdmin,
    canManageSettings: effectiveAdmin,
    canRunMaintenance: effectiveAdmin,
    isAuthResolving,
  };
}
