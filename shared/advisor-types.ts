import type { DemoEntity, EntityMap } from "./prototype";

export type AdvisorGoal = "wealth" | "income" | "debt" | "home";
export type RiskLevel = "low" | "medium" | "high";
export interface AdvisorProfile {
  portfolioId: string;
  goal: AdvisorGoal;
  targetMinor: number;
  horizonYears: 1 | 5 | 10;
  cashMinor: number;
  assetValueMinor: number;
  debtMinor: number;
  salaryMinor: number;
  businessIncomeMinor: number;
  livingMinor: number;
  installmentMinor: number;
  monthlyContributionMinor: number;
  emergencyReserveMinor: number;
  monthlyWithdrawalMinor: number;
  risk: RiskLevel;
  lockMonths: number;
  hoursMonthly: number;
  potentialFinancingMinor: number;
  approvedFinancingMinor: number;
  financingInstallmentMinor: number;
  dataDate: string;
  source: string;
  /** Optional inclusive YYYY-MM observation range; defaults to the trailing 12 months ending at dataDate. */
  operatingWindowStart?: string;
  operatingWindowEnd?: string;
}

export type OperatingFlowKind =
  | "arrears"
  | "bulk"
  | "deposit"
  | "recovery"
  | "unlinked"
  | "unclassifiedExpense";

export interface AdvisorOperatingEstimate {
  period: { start: string; end: string };
  months: number;
  totalCashMinor: number;
  averageMinor: number;
  confirmedObservedCashAverageMinor: number;
  sustainableMonthlyOperatingMinor: number;
  coverage: {
    observedMonths: number;
    zeroCashMonths: number;
    recurringIncomeMonths: number;
    recurringExpenseMonths: number;
  };
  excludedFlows: Array<{
    kind: OperatingFlowKind;
    label: string;
    amountMinor: number;
    count: number;
  }>;
  reliability: "insufficient" | "limited" | "sufficient";
}

export interface AdvisorDiagnosis {
  portfolioCashMinor: number;
  investableCashMinor: number;
  monthlySurplusMinor: number;
  contributionMinor: number;
  netWorthMinor: number;
  /** Present on a calculated diagnosis; omitted only by legacy UI placeholders. */
  initialGoalBasisMinor?: number;
  baselineEndMinor: number;
  goalGapMinor: number;
  additionalMonthlyMinor: number;
  monthsRequired: number | null;
  alerts: string[];
  /** Present on a calculated diagnosis; omitted only by legacy UI placeholders. */
  operatingEstimate?: AdvisorOperatingEstimate;
  sources: Array<{
    label: string;
    amountMinor: number;
    source: string;
    date: string;
  }>;
}

export interface CalculatedAdvisorDiagnosis extends AdvisorDiagnosis {
  initialGoalBasisMinor: number;
  operatingEstimate: AdvisorOperatingEstimate;
}

export interface AdvisorPath {
  id: string;
  label: string;
  risk: RiskLevel;
  suitable: boolean;
  reason: string;
  actions: string[];
  gate: string;
  resultLabel: string;
  projectedMinor: number | null;
}
export interface AdvisorStage {
  name: string;
  startMonth: number;
  endMonth: number;
  budgetMinor: number;
  indicator: string;
  gate: string;
  action: string;
}
export interface DealInput {
  purchaseMinor: number;
  developmentMinor: number;
  feesMinor: number;
  designMinor: number;
  operatingMinor: number;
  marketingMinor: number;
  reserveMinor: number;
  financingCostMinor: number;
  loanPrincipalMinor: number;
  saleMinor: number;
  monthlyRentMinor: number;
  monthlyOperatingMinor: number;
  vacancyPercent: number;
  buildMonths: number;
  marketingMonths: number;
  monthlyHoldingMinor: number;
}
export interface DealResult {
  initialMarginMinor: number;
  totalCostMinor: number;
  resultMinor: number;
  cycleReturnPercent: number | null;
  durationMonths: number;
  cashRequiredMinor: number;
  saleProceedsAfterDebtMinor: number;
  monthlyNetRentMinor: number;
  financingCostMinor: number;
  warnings: string[];
}
export interface DealStress {
  saleDeclinePercent: number;
  developmentIncreasePercent: number;
  delayMonths: number;
  financingRejected: boolean;
}
export interface ConstructionReviewInput {
  originalBudgetMinor: number;
  revisedCostMinor: number;
  evidenceStage: "quote" | "contract" | "paid";
  equivalentScope: boolean;
  projectCashMinor: number;
  upcomingPaymentsMinor: number;
  reserveMinor: number;
}
export interface ConstructionReviewResult {
  potentialSavingMinor: number;
  freeCashMinor: number;
  availableForSearchMinor: number;
  note: string;
}
export interface HunterBrief {
  portfolioId: string;
  cashBudgetMinor: number;
  potentialFinancingMinor: number;
  approvedFinancingMinor: number;
  goal: AdvisorGoal;
  risk: RiskLevel;
  maxMonths: number;
  country: string;
  createdAt: string;
  sourcePlanId: string;
}

export interface HunterFunding {
  usesMinor: number;
  requestedFacilityMinor: number;
  cashSourceMinor: number;
  appliedConfirmedFinancingMinor: number;
  potentialFinancingMinor: number;
  appliedPotentialFinancingMinor: number;
  confirmedSourcesMinor: number;
  conditionalSourcesMinor: number;
  fundingGapMinor: number;
  conditionalFundingGapMinor: number;
}

export interface HunterEconomicEligibility {
  goal: AdvisorGoal;
  eligible: boolean;
  viable: boolean;
  reasons: string[];
  missing: string[];
  criteria: Array<{
    id: string;
    label: string;
    met: boolean | null;
    amountMinor?: number;
  }>;
}

export interface HunterEvaluation {
  id: string;
  suitable: boolean;
  conditional: boolean;
  financiallyFit: boolean;
  state: string;
  reason: string;
  reasons: string[];
  score: number;
  missing: string[];
  funding: HunterFunding;
  economicEligibility: HunterEconomicEligibility;
  result: DealResult;
}
export type AdvisorEntities = EntityMap;
export type AdvisorEntity = DemoEntity;
