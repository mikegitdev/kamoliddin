import { lazy } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";
import { RootLayout } from "@/app/RootLayout";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RouteErrorPage } from "@/pages/RouteErrorPage";

// Route-level code splitting: staff console, cabinet, editor, demo pay and the
// public detail pages each load on first visit instead of fusing into the
// entry chunk (per-file imports — the pages/app barrel would undo the split).
// RouteErrorPage/NotFoundPage stay eager: they must render when a lazy chunk
// fails to load.
const LocationDetailPage = lazy(() =>
  import("@/pages/LocationDetailPage").then((m) => ({ default: m.LocationDetailPage })),
);
const PublicAdPage = lazy(() =>
  import("@/pages/PublicAdPage").then((m) => ({ default: m.PublicAdPage })),
);
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const DemoPayPage = lazy(() =>
  import("@/pages/DemoPayPage").then((m) => ({ default: m.DemoPayPage })),
);
const StaffPage = lazy(() =>
  import("@/pages/StaffPage").then((m) => ({ default: m.StaffPage })),
);
const AdvertiserLayout = lazy(() =>
  import("@/pages/app/layout").then((m) => ({ default: m.AdvertiserLayout })),
);
const OverviewPage = lazy(() =>
  import("@/pages/app/OverviewPage").then((m) => ({ default: m.OverviewPage })),
);
const BusinessProfilePage = lazy(() =>
  import("@/pages/app/BusinessProfilePage").then((m) => ({ default: m.BusinessProfilePage })),
);
const BranchesPage = lazy(() =>
  import("@/pages/app/BranchesPage").then((m) => ({ default: m.BranchesPage })),
);
const CampaignsPage = lazy(() =>
  import("@/pages/app/CampaignsPage").then((m) => ({ default: m.CampaignsPage })),
);
const CampaignDetailPage = lazy(() =>
  import("@/pages/app/CampaignDetailPage").then((m) => ({ default: m.CampaignDetailPage })),
);
const CampaignEditorPage = lazy(() =>
  import("@/pages/app/CampaignEditorPage").then((m) => ({ default: m.CampaignEditorPage })),
);
const CheckoutPage = lazy(() =>
  import("@/pages/app/CheckoutPage").then((m) => ({ default: m.CheckoutPage })),
);
const BillingPage = lazy(() =>
  import("@/pages/app/BillingPage").then((m) => ({ default: m.BillingPage })),
);
const OrderDetailPage = lazy(() =>
  import("@/pages/app/OrderDetailPage").then((m) => ({ default: m.OrderDetailPage })),
);
const AccountPage = lazy(() =>
  import("@/pages/app/AccountPage").then((m) => ({ default: m.AccountPage })),
);

/** Data router (createBrowserRouter): enables useBlocker for the dirty-form
 *  route-leave guards. Route tree is identical to the previous <Routes>. */
export const router = createBrowserRouter([
  {
    // Pathless root: one error boundary for every route below. The layout
    // restores scroll on Back/Forward and renders the (kept-alive) map.
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: "/", element: null }, // the map lives in RootLayout
      { path: "/locations/:id", element: <LocationDetailPage /> },
      { path: "/ads/:id", element: <PublicAdPage /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/staff", element: <StaffPage /> },
      // Mock provider card page (fake-gateway stacks only; see DemoPayPage).
      { path: "/pay/:provider/:orderId", element: <DemoPayPage /> },
      {
        path: "/app",
        element: <AdvertiserLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: "business", element: <BusinessProfilePage /> },
          { path: "locations", element: <BranchesPage /> },
          { path: "campaigns", element: <CampaignsPage /> },
          { path: "campaigns/new", element: <CampaignEditorPage /> },
          { path: "campaigns/:id", element: <CampaignDetailPage /> },
          { path: "campaigns/:id/edit", element: <CampaignEditorPage /> },
          { path: "checkout/:id", element: <CheckoutPage /> },
          { path: "billing", element: <BillingPage /> },
          { path: "orders/:id", element: <OrderDetailPage /> },
          { path: "account", element: <AccountPage /> },
        ],
      },
      { path: "/admin", element: <Navigate to="/admin/" replace /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
