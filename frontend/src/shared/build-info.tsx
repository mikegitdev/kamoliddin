import { useBackendRelease } from "@/shared/api/queries";

/** "2026-11-02T10:34:46+05:00" → "2026-11-02 10:34" (commit-local time). */
const stamp = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** One console line per page load — the public site has no menu to host
 *  the stamp, so DevTools is where to check which frontend is live. */
export function logBuildInfo(): void {
  const { sha, date, builtAt } = __BUILD_INFO__;
  console.info(`[Local Ads] web ${sha} (${stamp(date)}) · built ${builtAt}`);
}

/** Release stamps for "did the hotfix land?" checks: last frontend/ and
 *  backend/ commits. Deliberately tiny and tucked into the user menu. */
export function BuildStamp() {
  const fe = __BUILD_INFO__;
  const { data: be, isError } = useBackendRelease();
  const beText = be ? `${be.sha} · ${stamp(be.date)}` : isError ? "—" : "…";
  return (
    <span
      className="build-stamp"
      title={`web built ${fe.builtAt}${be?.built_at ? `\napi built ${be.built_at}` : ""}`}
    >
      <span>web {fe.sha} · {stamp(fe.date)}</span>
      <span>api {beText}</span>
    </span>
  );
}
