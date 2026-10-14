import { Navigate, createBrowserRouter } from "react-router-dom";
import { MapHomePage } from "@/pages/MapHomePage";
import { LocationDetailPage } from "@/pages/LocationDetailPage";
import { PublicAdPage } from "@/pages/PublicAdPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { StaffPage } from "@/pages/StaffPage";
import {
  AdvertiserLayout,
  OverviewPage,
  BusinessProfilePage,
  BranchesPage,
  CampaignsPage,
  CampaignDetailPage,
  CampaignEditorPage,
  CheckoutPage,
  BillingPage,
  OrderDetailPage,
  AccountPage,
} from "@/pages/app";

/** Data router (createBrowserRouter): enables useBlocker for the dirty-form
 *  route-leave guards. Route tree is identical to the previous <Routes>. */
export const router = createBrowserRouter([
  { path: "/", element: <MapHomePage /> },
  { path: "/locations/:id", element: <LocationDetailPage /> },
  { path: "/ads/:id", element: <PublicAdPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/staff", element: <StaffPage /> },
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
]);
