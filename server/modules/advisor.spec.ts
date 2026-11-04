import { afterEach, describe, expect, it, vi } from "vitest";
import { advisorRouter, advisorProfileSchema, explainNumbers } from "./advisor";
import type { TrpcContext } from "../_core/context";
import { createDemoState } from "../../client/src/lib/demo-data";
const profile = {
  portfolioId: "personal",
  goal: "wealth" as const,
  targetMinor: 1_000_000_000,
  horizonYears: 5 as const,
  cashMinor: 10_000_000,
  assetValueMinor: 0,
  debtMinor: 0,
  salaryMinor: 2_000_000,
  businessIncomeMinor: 0,
  livingMinor: 1_500_000,
  installmentMinor: 0,
  monthlyContributionMinor: 200_000,
  emergencyReserveMinor: 0,
  monthlyWithdrawalMinor: 0,
  risk: "low" as const,
  lockMonths: 12,
  hoursMonthly: 4,
  potentialFinancingMinor: 0,
  approvedFinancingMinor: 0,
  financingInstallmentMinor: 0,
  dataDate: "2026-10-24",
  source: "تجربة",
};
const ctx = (id: number | null): TrpcContext => ({
  user:
    id === null
      ? null
      : {
          id,
          openId: `test-${id}`,
          name: null,
          email: null,
          loginMethod: "manus",
          role: "user",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        },
  req: {} as TrpcContext["req"],
  res: { setHeader: vi.fn() } as unknown as TrpcContext["res"],
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("optional advisor explanation boundaries", () => {
  it("P01 blocks deferred advisor RPC before provider access", async () => {
    const snapshot = createDemoState();
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    await expect(
      advisorRouter
        .createCaller(ctx(909))
        .explain({
          profile: {
            ...profile,
            portfolioId: snapshot.entities.portfolios[0].id,
          },
          snapshot,
          consent: true,
        })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects fractional and negative monetary input", () => {
    expect(
      advisorProfileSchema.safeParse({ ...profile, cashMinor: -1 }).success
    ).toBe(false);
    expect(
      advisorProfileSchema.safeParse({ ...profile, cashMinor: 0.5 }).success
    ).toBe(false);
  });
  it("requires a real authenticated caller", async () => {
    await expect(
      advisorRouter
        .createCaller(ctx(null))
        .explain({ profile, snapshot: createDemoState(), consent: true })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("refuses combined portfolio and no consent", async () => {
    const snapshot = createDemoState();
    await expect(
      advisorRouter.createCaller(ctx(901)).explain({
        profile: { ...profile, portfolioId: "all" },
        snapshot,
        consent: true,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(() =>
      advisorProfileSchema.parse({ ...profile, unknownKey: "unsafe" })
    ).toThrow();
  });
  it("does not use an unavailable AI provider or return a pretend answer", async () => {
    vi.stubEnv("MANUS_API_URL", "");
    vi.stubEnv("BUILT_IN_FORGE_API_URL", "");
    vi.stubEnv("MANUS_API_KEY", "");
    vi.stubEnv("BUILT_IN_FORGE_API_KEY", "");
    await expect(explainNumbers({ cashMinor: 123 })).rejects.toThrow(
      "AI_UNAVAILABLE"
    );
  });
  it("rejects provider text that creates a replacement number", async () => {
    vi.stubEnv("MANUS_API_URL", "https://example.invalid");
    vi.stubEnv("MANUS_API_KEY", "unit-test-only");
    const mocked = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-6-luna" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "ستصل إلى 1000000" } }],
        }),
      });
    vi.stubGlobal("fetch", mocked);
    await expect(explainNumbers({})).rejects.toThrow("AI_INVALID_EXPLANATION");
  });
  it("accepts explanatory text without changing figures", async () => {
    vi.stubEnv("MANUS_API_URL", "https://example.invalid");
    vi.stubEnv("MANUS_API_KEY", "unit-test-only");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [{ id: "gpt-6-luna" }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content:
                    "الفجوة تحتاج مراجعة المدة والمساهمة. التمويل المحتمل ليس نقدًا مؤكدًا.",
                },
              },
            ],
          }),
        })
    );
    expect(await explainNumbers({})).toContain("الفجوة");
  });
});
