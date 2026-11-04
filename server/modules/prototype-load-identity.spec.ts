import { describe, it, expect, vi } from "vitest";
import {
  createPrototypeRouter,
  type PrototypeWorkspaceStore,
} from "./prototype";
import type { TrpcContext } from "../_core/context";
describe("R08staleaccountload", () => {
  it("doesnotreadstorewhenrequestedaccountdiffersfromserveridentity", async () => {
    const store: PrototypeWorkspaceStore = {
      load: vi.fn(async () => undefined),
      create: vi.fn(async () => true),
      compareAndSwap: vi.fn(async () => true),
    };
    const router = createPrototypeRouter(store);
    const ctx = {
      user: {
        id: 22,
        openId: "fixture-22",
        role: "user",
        name: "Test",
        email: null,
        loginMethod: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: {},
      res: { setHeader: vi.fn() },
    } as unknown as TrpcContext;
    const caller = router.createCaller(ctx);
    await expect(caller.load({ clientUserId: 11 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(store.load).not.toHaveBeenCalled();
    await expect(caller.load({ clientUserId: 22 })).resolves.toEqual({
      snapshot: null,
      revision: 0,
    });
    expect(store.load).toHaveBeenCalledWith(22);
  });
});
