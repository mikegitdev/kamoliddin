/**
 * SPA route-leave guard for dirty forms (design review 0.3). `beforeunload`
 * only covers reload/close — in-app navigation (nav tabs, links) silently
 * dropped edits. Requires the data router (createBrowserRouter), so this
 * hook must run below it.
 *
 * Returns `bypassNextNav()`: flows that intentionally navigate right after
 * saving (e.g. submit → campaign page) call it so the guard stays quiet.
 */
import { useCallback, useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";
import { confirmDialog } from "@/shared/dialog";
import { useI18n } from "@/shared/i18n";

// Count of currently-dirty mounted forms (see useDirtyRouteGuard).
let dirtyForms = 0;
function notifyDirty() {
  /* reserved for subscribers; the switcher reads on change events */
}
function registerDirtyForm() {
  dirtyForms += 1;
  notifyDirty();
}
function unregisterDirtyForm() {
  dirtyForms -= 1;
  notifyDirty();
}
/** True when any mounted form has unsaved edits. */
export function anyDirtyForms(): boolean {
  return dirtyForms > 0;
}

export function useDirtyRouteGuard(when: boolean) {
  const { t } = useI18n();
  const allowNext = useRef(false);
  const resolving = useRef(false);
  // Mirror the dirtiness into a module counter so NON-router actors (the
  // business switcher remounts pages without a navigation) can warn too.
  useEffect(() => {
    if (!when) return;
    registerDirtyForm();
    return unregisterDirtyForm;
  }, [when]);
  const blocker = useBlocker(() => {
    if (allowNext.current) {
      allowNext.current = false;
      return false;
    }
    return when;
  });

  useEffect(() => {
    if (blocker.state !== "blocked" || resolving.current) return;
    resolving.current = true;
    void confirmDialog({
      t,
      title: t.confirmTitle,
      body: t.confirmLeavePage,
      confirmLabel: t.leaveAnyway,
      cancelLabel: t.keepEditing,
      danger: true,
    }).then((ok) => {
      resolving.current = false;
      if (ok) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, t]);

  const bypassNextNav = useCallback(() => {
    allowNext.current = true;
  }, []);

  return { bypassNextNav };
}
