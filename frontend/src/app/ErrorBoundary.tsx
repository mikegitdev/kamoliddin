import { Component, type ReactNode } from "react";
import { CrashScreen } from "@/shared/crash-screen";
import { ru, type Dict } from "@/shared/i18n/ru";
import { uz } from "@/shared/i18n/uz";

/** Root safety net above the router: its errorElement only covers crashes in
 *  routes, so a render crash in the providers/app shell itself would
 *  white-screen without this boundary. */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error(error, info);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    // Runs outside the (possibly crashed) i18n provider: read <html lang>
    // directly — same pattern as toast.tsx.
    const t: Dict = document.documentElement.lang === "uz" ? uz : ru;
    return <CrashScreen t={t} />;
  }
}
