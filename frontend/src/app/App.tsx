import { Suspense } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { Providers } from "./providers";

export function App() {
  return (
    <Providers>
      {/* Lazy route chunks resolve here; null keeps the previous frame until
          the chunk is ready instead of flashing a spinner on every split. */}
      <Suspense fallback={null}>
        <RouterProvider router={router} />
      </Suspense>
    </Providers>
  );
}
