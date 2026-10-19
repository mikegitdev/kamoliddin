import { useState } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router-dom";
import { MapHomePage } from "@/pages/MapHomePage";

/** Pages opened from the map. While one of them is showing, the map stays
 *  mounted (hidden) so Back returns to it instantly — no MapLibre re-init,
 *  tile reload, or lost camera/selection. */
const MAP_CHILD = /^\/(ads|locations)\/[^/]+\/?$/;

export function RootLayout() {
  const { pathname } = useLocation();
  const onMap = pathname === "/";
  const [mapMounted, setMapMounted] = useState(onMap);
  // Render-phase sync (React's "adjust state on prop change" pattern): mount
  // on first visit to "/", drop it once the visitor leaves the map's family.
  if (onMap && !mapMounted) setMapMounted(true);
  if (!onMap && !MAP_CHILD.test(pathname) && mapMounted) setMapMounted(false);

  return (
    <>
      <ScrollRestoration />
      {mapMounted && (
        // visibility (not display:none) keeps the container's size, so the
        // map never resizes to 0×0 and fires bogus viewport changes.
        <div className={onMap ? "map-keepalive" : "map-keepalive is-hidden"} inert={!onMap}>
          <MapHomePage active={onMap} />
        </div>
      )}
      <Outlet />
    </>
  );
}
