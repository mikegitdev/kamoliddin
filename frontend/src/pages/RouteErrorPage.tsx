import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { CrashScreen } from "@/shared/crash-screen";
import { useI18n } from "@/shared/i18n";
import { NotFoundPage } from "./NotFoundPage";

/** Router errorElement: a render/runtime crash in any route lands here
 *  instead of React Router's default developer screen. Crashes above the
 *  router are caught by the root ErrorBoundary (app/ErrorBoundary.tsx). */
export function RouteErrorPage() {
  const { t } = useI18n();
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  console.error(error);

  return <CrashScreen t={t} />;
}
