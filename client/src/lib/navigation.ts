import {
  Building2,
  Wallet,
  Users,
  FileText,
  CircleDollarSign,
  ChartNoAxesCombined,
  ReceiptText,
  ArrowLeftRight,
  CreditCard,
  Files,
  DoorOpen,
  Wrench,
  ShieldCheck,
  ClipboardCheck,
  Scale,
  ListTodo,
  Bell,
  PanelsTopLeft,
  MessageCircle,
  Megaphone,
  PenLine,
  TrendingUp,
  Compass,
  Database,
  Landmark,
  Settings2,
  Boxes,
  LayoutDashboard,
  BriefcaseBusiness,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { phaseFeature, phaseFeatureCounts } from "@shared/phase1-features";
export interface NavItem {
  path: string;
  label: string;
  english: string;
  icon: LucideIcon;
}
export interface NavGroup {
  title: string;
  titleEn: string;
  items: NavItem[];
}
export const navigation: NavGroup[] = [
  {
    title: "نظرة عامة",
    titleEn: "Overview",
    items: [
      {
        path: "/dashboard",
        label: "لوحة التحكم",
        english: "Dashboard",
        icon: LayoutDashboard,
      },
      {
        path: "/insights",
        label: "التحليل والاقتراحات",
        english: "Insights & suggestions",
        icon: TrendingUp,
      },
      {
        path: "/roadmap",
        label: "فهرس خدمات النظام",
        english: "Service catalog",
        icon: Boxes,
      },
    ],
  },
  {
    title: "إدارة الأملاك",
    titleEn: "Property management",
    items: [
      {
        path: "/portfolios",
        label: "المحافظ",
        english: "Portfolios",
        icon: Wallet,
      },
      {
        path: "/properties",
        label: "العقارات والوحدات",
        english: "Properties & units",
        icon: Building2,
      },
      {
        path: "/unleased",
        label: "وحدات غير مؤجرة",
        english: "Vacant units & letting",
        icon: DoorOpen,
      },
      {
        path: "/sale-units",
        label: "وحدات للبيع",
        english: "Units for sale",
        icon: Building2,
      },
      {
        path: "/ownership",
        label: "الشركاء والملكية",
        english: "Partners & ownership",
        icon: Users,
      },
      {
        path: "/leases",
        label: "المستأجرون والعقود",
        english: "Tenants & leases",
        icon: FileText,
      },
      {
        path: "/contract-templates",
        label: "نماذج العقود",
        english: "Contract templates",
        icon: FileText,
      },
      {
        path: "/billing",
        label: "الفواتير والمستحقات",
        english: "Invoices & dues",
        icon: ReceiptText,
      },
      {
        path: "/collections",
        label: "التحصيل والشيكات",
        english: "Collections & cheques",
        icon: CircleDollarSign,
      },
      {
        path: "/finance",
        label: "المالية والسيولة",
        english: "Finance & liquidity",
        icon: ChartNoAxesCombined,
      },
      {
        path: "/expenses",
        label: "المصروفات والإيصالات",
        english: "Expenses & receipts",
        icon: ReceiptText,
      },
      {
        path: "/reconciliation",
        label: "المطابقة البنكية",
        english: "Bank reconciliation",
        icon: ArrowLeftRight,
      },
      {
        path: "/payments",
        label: "روابط الدفع",
        english: "Payment links",
        icon: CreditCard,
      },
      {
        path: "/reports",
        label: "الكشوف والتقارير",
        english: "Statements & reports",
        icon: Files,
      },
    ],
  },
  {
    title: "التشغيل والخدمات",
    titleEn: "Operations & services",
    items: [
      {
        path: "/documents",
        label: "خزنة المستندات",
        english: "Document vault",
        icon: Files,
      },
      {
        path: "/vacancy",
        label: "الشغور والتجهيز",
        english: "Vacancy & readiness",
        icon: DoorOpen,
      },
      {
        path: "/maintenance",
        label: "الصيانة والوقاية",
        english: "Maintenance & prevention",
        icon: Wrench,
      },
      {
        path: "/vendors",
        label: "الموردون والفنيون",
        english: "Vendors & technicians",
        icon: BriefcaseBusiness,
      },
      {
        path: "/inspections",
        label: "الاستلام والتسليم",
        english: "Move-in & move-out",
        icon: ClipboardCheck,
      },
      {
        path: "/disputes",
        label: "النزاعات والقضايا",
        english: "Disputes & cases",
        icon: Scale,
      },
      {
        path: "/tasks",
        label: "المهام والموجز",
        english: "Tasks & daily brief",
        icon: ListTodo,
      },
      {
        path: "/notifications",
        label: "التنبيهات والقنوات",
        english: "Alerts & channels",
        icon: Bell,
      },
      {
        path: "/portals",
        label: "بوابات الأطراف",
        english: "Party portals",
        icon: PanelsTopLeft,
      },
      {
        path: "/assistant",
        label: "مساعد واتساب",
        english: "WhatsApp assistant",
        icon: MessageCircle,
      },
      {
        path: "/marketing",
        label: "التسويق العقاري",
        english: "Property marketing",
        icon: Megaphone,
      },
      {
        path: "/signatures",
        label: "التوقيع الإلكتروني",
        english: "E-signatures",
        icon: PenLine,
      },
    ],
  },
  {
    title: "النمو والقرار",
    titleEn: "Growth & decisions",
    items: [
      {
        path: "/market",
        label: "سوق الإيجارات",
        english: "Rental market",
        icon: TrendingUp,
      },
      {
        path: "/growth",
        label: "المستشار العقاري",
        english: "Real-estate advisor",
        icon: Compass,
      },
      {
        path: "/opportunities",
        label: "قناص الفرص",
        english: "Opportunity hunter",
        icon: TrendingUp,
      },
      {
        path: "/funding",
        label: "جاهزية التمويل",
        english: "Funding readiness",
        icon: Landmark,
      },
      {
        path: "/data",
        label: "المصادر وجودة البيانات",
        english: "Sources & data quality",
        icon: Database,
      },
    ],
  },
  {
    title: "إدارة المنصة",
    titleEn: "Platform",
    items: [
      {
        path: "/settings",
        label: "الصلاحيات والاشتراكات",
        english: "Roles & plans",
        icon: Settings2,
      },
    ],
  },
];
export const allNavigation = navigation.flatMap(group => group.items);
export const navigationState = (path: string) =>
  phaseFeature(path)?.state ?? "coming-soon";
export const navigationCounts = phaseFeatureCounts;
export const ROLE_LABELS = {
  operator: "معاينة الموظف",
  owner: "معاينة صاحب القرار",
  tenant: "معاينة المستأجر",
  vendor: "معاينة المقاول",
};
export const ROLE_LABELS_EN: Record<keyof typeof ROLE_LABELS, string> = {
  operator: "Preview as staff",
  owner: "Preview as decision maker",
  tenant: "Preview as tenant",
  vendor: "Preview as contractor",
};

export const PRIMARY_PATHS = [
  "/dashboard",
  "/properties",
  "/unleased",
  "/sale-units",
  "/marketing",
  "/leases",
  "/billing",
  "/collections",
  "/tasks",
  "/insights",
  "/growth",
  "/opportunities",
] as const;
