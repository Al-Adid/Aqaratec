import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import { LandingPage } from "./pages/public/LandingPage";
import { AccountEntryPage } from "./pages/public/AccountEntryPage";
import { SuperAdminLoginPage } from "./pages/super-admin/SuperAdminLoginPage";
import { SuperAdminDashboardPage } from "./pages/super-admin/SuperAdminDashboardPage";
import { ApplicationEntryGate } from "./components/app/ApplicationEntryGate";
import { BrokerMarketingPage } from "./pages/marketing/BrokerMarketingPage";
import { SaleUnitsPage } from "./pages/marketing/SaleUnitsPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { SiteMetadata } from "./components/SiteMetadata";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DomTranslator, LanguageProvider } from "./i18n";
import { WorkspaceIdentityBoundary } from "./components/app/WorkspaceIdentityBoundary";
import { AppFrame } from "./components/app/AppFrame";
import NotFound from "./pages/NotFound";
import { PhaseFeatureGate } from "./components/app/PhaseFeatureGate";
import Dashboard from "./pages/Dashboard";
import { RealEstateAdvisorPage } from "./pages/advisory/RealEstateAdvisorPage";
import { BillingPage } from "./pages/billing/BillingPage";
import { ContractTemplatesPage } from "./pages/contracts/ContractTemplatesPage";
import { UnleasedPage } from "./pages/letting/UnleasedPage";
import { OpportunityHunterPage } from "./pages/advisory/OpportunityHunterPage";
import { PortfolioInsightsPage } from "./pages/decision/PortfolioInsightsPage";
import {
  PortfoliosPage,
  PropertiesPage,
  PropertyDetailPage,
  LeasesPage,
  CollectionsPage,
  FinancePage,
  ExpensesPage,
  ReconciliationPage,
  PaymentsPage,
  ReportsPage,
  VacancyPage,
} from "./pages/OperatingPages";
import {
  DocumentsPage,
  MaintenancePage,
  VendorsPage,
  InspectionsPage,
  DisputesPage,
  TasksPage,
  NotificationsPage,
  PortalsPage,
  AssistantPage,
  MarketingPage,
  SignaturesPage,
} from "./pages/ServicePages";
import {
  OwnershipPage,
  MarketPage,
  DataPage,
  FundingPage,
  SettingsPage,
  RoadmapPage,
} from "./pages/DecisionPages";

function Router() {
  return (
    <Switch>
      <Route path="/dashboard">
        <PhaseFeatureGate path="/dashboard">
          <Dashboard />
        </PhaseFeatureGate>
      </Route>
      <Route path="/insights">
        <PhaseFeatureGate path="/insights">
          <PortfolioInsightsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/portfolios">
        <PhaseFeatureGate path="/portfolios">
          <PortfoliosPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/ownership">
        <PhaseFeatureGate path="/ownership">
          <OwnershipPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/properties">
        <PhaseFeatureGate path="/properties">
          <PropertiesPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/properties/:id">
        {params => <PropertyDetailPage id={params.id} />}
      </Route>
      <Route path="/leases">
        <PhaseFeatureGate path="/leases">
          <LeasesPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/contract-templates">
        <PhaseFeatureGate path="/contract-templates">
          <ContractTemplatesPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/unleased">
        <PhaseFeatureGate path="/unleased">
          <UnleasedPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/sale-units">
        <PhaseFeatureGate path="/sale-units">
          <SaleUnitsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/collections">
        <PhaseFeatureGate path="/collections">
          <CollectionsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/billing">
        <PhaseFeatureGate path="/billing">
          <BillingPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/finance">
        <PhaseFeatureGate path="/finance">
          <FinancePage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/expenses">
        <PhaseFeatureGate path="/expenses">
          <ExpensesPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/reconciliation">
        <PhaseFeatureGate path="/reconciliation">
          <ReconciliationPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/payments">
        <PhaseFeatureGate path="/payments">
          <PaymentsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/reports">
        <PhaseFeatureGate path="/reports">
          <ReportsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/documents">
        <PhaseFeatureGate path="/documents">
          <DocumentsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/vacancy">
        <PhaseFeatureGate path="/vacancy">
          <VacancyPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/maintenance">
        <PhaseFeatureGate path="/maintenance">
          <MaintenancePage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/vendors">
        <PhaseFeatureGate path="/vendors">
          <VendorsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/inspections">
        <PhaseFeatureGate path="/inspections">
          <InspectionsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/disputes">
        <PhaseFeatureGate path="/disputes">
          <DisputesPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/tasks">
        <PhaseFeatureGate path="/tasks">
          <TasksPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/notifications">
        <PhaseFeatureGate path="/notifications">
          <NotificationsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/portals">
        <PhaseFeatureGate path="/portals">
          <PortalsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/assistant">
        <PhaseFeatureGate path="/assistant">
          <AssistantPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/marketing">
        <PhaseFeatureGate path="/marketing">
          <BrokerMarketingPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/signatures">
        <PhaseFeatureGate path="/signatures">
          <SignaturesPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/market">
        <PhaseFeatureGate path="/market">
          <MarketPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/growth">
        <PhaseFeatureGate path="/growth">
          <RealEstateAdvisorPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/opportunities">
        <PhaseFeatureGate path="/opportunities">
          <OpportunityHunterPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/data">
        <PhaseFeatureGate path="/data">
          <DataPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/funding">
        <PhaseFeatureGate path="/funding">
          <FundingPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/settings">
        <PhaseFeatureGate path="/settings">
          <SettingsPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/roadmap">
        <PhaseFeatureGate path="/roadmap">
          <RoadmapPage />
        </PhaseFeatureGate>
      </Route>
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}
function ManagementApplication({
  forceDemo = false,
  demoSessionActive,
  onDemoSessionChange,
}: {
  forceDemo?: boolean;
  demoSessionActive: boolean;
  onDemoSessionChange: (active: boolean) => void;
}) {
  return (
    <ApplicationEntryGate
      forceDemo={forceDemo}
      demoSessionActive={demoSessionActive}
      onDemoSessionChange={onDemoSessionChange}
    >
      <WorkspaceIdentityBoundary>
        <AppFrame>{forceDemo ? <Dashboard /> : <Router />}</AppFrame>
      </WorkspaceIdentityBoundary>
    </ApplicationEntryGate>
  );
}
export default function App() {
  const [demoSessionActive, setDemoSessionActive] = useState(false);
  return (
    <ErrorBoundary>
      <LanguageProvider>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <DomTranslator />
          <SiteMetadata />
          <Toaster position="top-center" richColors />
          <Switch>
            <Route path="/" component={LandingPage} />
            <Route path="/login">
              <AccountEntryPage mode="login" />
            </Route>
            <Route path="/register">
              <AccountEntryPage mode="register" />
            </Route>
            {/*
              Platform-operator area. Deliberately not linked from the
              landing page, the owner app's nav, or anywhere else — it is
              reachable only by typing the URL. The actual access control is
              server-side (adminProcedure, role === "admin"), not this
              omission; see SuperAdminDashboardPage's docstring.
            */}
            <Route path="/super-admin/login" component={SuperAdminLoginPage} />
            <Route path="/super-admin" component={SuperAdminDashboardPage} />
            <Route path="/demo">
              <ManagementApplication
                forceDemo
                demoSessionActive={demoSessionActive}
                onDemoSessionChange={setDemoSessionActive}
              />
            </Route>
            <Route>
              <ManagementApplication
                demoSessionActive={demoSessionActive}
                onDemoSessionChange={setDemoSessionActive}
              />
            </Route>
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
