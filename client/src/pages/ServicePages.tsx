import { DocumentsService, SignaturesService } from "./services/DocumentServices";
import { DisputesService, NotificationsService, TasksService } from "./services/CoordinationServices";
import { AssistantService, MarketingService, PortalsService } from "./services/EngagementServices";
import { InspectionsService, MaintenanceService, VendorsService } from "./services/OperationsServices";

/** Named route exports are intentionally kept thin; each feature lives in its focused service module. */
export function DocumentsPage() { return <DocumentsService />; }
export function MaintenancePage() { return <MaintenanceService />; }
export function VendorsPage() { return <VendorsService />; }
export function InspectionsPage() { return <InspectionsService />; }
export function DisputesPage() { return <DisputesService />; }
export function TasksPage() { return <TasksService />; }
export function NotificationsPage() { return <NotificationsService />; }
export function PortalsPage() { return <PortalsService />; }
export function AssistantPage() { return <AssistantService />; }
export function MarketingPage() { return <MarketingService />; }
export function SignaturesPage() { return <SignaturesService />; }
