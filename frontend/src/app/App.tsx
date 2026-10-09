import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "./router";
import { Providers } from "./providers";

export function App() {
  return (
    <BrowserRouter>
      <Providers>
        <AppRouter />
      </Providers>
    </BrowserRouter>
  );
}
