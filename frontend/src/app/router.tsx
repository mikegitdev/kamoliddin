import { Navigate, Route, Routes } from "react-router-dom";
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
} from "@/pages/app";

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<MapHomePage />} />
      <Route path="/locations/:id" element={<LocationDetailPage />} />
      <Route path="/ads/:id" element={<PublicAdPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/staff" element={<StaffPage />} />
      <Route path="/app" element={<AdvertiserLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="business" element={<BusinessProfilePage />} />
        <Route path="locations" element={<BranchesPage />} />
        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="campaigns/new" element={<CampaignEditorPage />} />
        <Route path="campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="campaigns/:id/edit" element={<CampaignEditorPage />} />
        <Route path="checkout/:id" element={<CheckoutPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
      </Route>
      <Route path="/admin" element={<Navigate to="/admin/" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
