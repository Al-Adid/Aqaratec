import { describe, expect, it } from "vitest";
import { type PrototypeState } from "@shared/prototype";
import { createDemoState } from "./demo-data";
import {
  generateTemplateLease,
  getTemplateLeaseView,
  refreshRenewalTemplateSnapshot,
  saveLeaseTemplate,
} from "./lease-template-engine";
import { activateLease, renewLease } from "./prototype-lease-lifecycle";

const CONTENT =
  "المستأجر: {{الاسم}} | العقار: {{رقم_العقار}} | الكهرباء: {{رقم_الكهرباء}} | النوع: {{نوع_العقار}}";

function fixtureState(): PrototypeState {
  const state = createDemoState();
  state.settings.portfolioId = "family";
  state.entities.properties = state.entities.properties.map(property =>
    property.id === "building"
      ? {
          ...property,
          meta: {
            ...property.meta,
            assetType: "building",
            rentalMode: "units",
            propertyNumber: "B-21",
            electricityNumber: "00129",
          },
        }
      : property
  );
  return state;
}

function replaceGeneratedSnapshotId(
  state: PrototypeState,
  leaseId: string,
  oldDocumentId: string,
  replacementId: string
): PrototypeState {
  return {
    ...state,
    entities: {
      ...state.entities,
      leases: state.entities.leases.map(lease =>
        lease.id === leaseId
          ? {
              ...lease,
              meta: {
                ...lease.meta,
                snapshotDocumentId: replacementId,
                registrationStatus: "مسجل",
                registrationNumber: "OLD-123",
                signedStatus: "موقع",
                signatureProof: "OLD-SIGNATURE",
              },
            }
          : lease
      ),
      documents: state.entities.documents.map(document => {
        if (document.id === oldDocumentId)
          return { ...document, id: replacementId };
        if (document.meta.parentId === oldDocumentId)
          return {
            ...document,
            meta: { ...document.meta, parentId: replacementId },
          };
        return document;
      }),
    },
  };
}

function documentCount(state: PrototypeState): number {
  return state.entities.documents.length;
}

describe("B01 · renewal template snapshots", () => {
  it("rejects activation without a new snapshot, then creates one independent current document exactly once", () => {
    const saved = saveLeaseTemplate(fixtureState(), {
      requestId: "b01-template-v1",
      name: "قالب تجديد سنوي",
      content: CONTENT,
      fileName: "renewal.txt",
      defaultRentMinor: 120_000,
      defaultTermMonths: 12,
    });
    const generated = generateTemplateLease(saved.state, {
      requestId: "b01-original",
      templateId: saved.template.id,
      propertyId: "building",
      unitId: "u-b6",
      tenantName: "مستأجر التجديد",
      propertyNumber: "B-21",
      electricityNumber: "OLD-METER",
      propertyType: "عمارة",
      startDate: "2026-01-01",
    });
    const withOldProof = replaceGeneratedSnapshotId(
      generated.state,
      generated.lease.id,
      generated.document.id,
      "OLD-DOC"
    );
    const originalBeforeRenewal = getTemplateLeaseView(
      withOldProof.entities,
      generated.lease.id
    );
    expect(originalBeforeRenewal.document.id).toBe("OLD-DOC");
    expect(originalBeforeRenewal.content).toContain("OLD-METER");

    const originalActivated = activateLease(
      withOldProof,
      generated.lease.id,
      "2026-10-24"
    );
    const renewed = renewLease(originalActivated.state, generated.lease.id, {
      title: "تجديد 2026-2027",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      rent: "1200",
      terminatePrevious: "confirm",
      newTemplateStep: "confirm",
      requestId: "b01-renewal",
    });
    const renewalLeaseId = renewed.result.id;
    const renewalDocumentsBefore = documentCount(renewed.state);
    const renewalReceivablesBefore = renewed.state.entities.receivables.filter(
      row => row.meta.leaseId === renewalLeaseId
    );

    expect(renewed.result.meta).toMatchObject({
      priorLeaseId: generated.lease.id,
      historicalLeaseRef: generated.lease.id,
      newTemplateSnapshotRequired: true,
      registrationStatus: "غير متحقق",
      signedStatus: "مسودة غير موقعة",
    });
    expect(() =>
      activateLease(renewed.state, renewalLeaseId, "2026-10-24")
    ).toThrow("توليد وثيقة تجديد جديدة");
    expect(documentCount(renewed.state)).toBe(renewalDocumentsBefore);
    expect(
      renewed.state.entities.receivables.filter(
        row => row.meta.leaseId === renewalLeaseId
      )
    ).toEqual(renewalReceivablesBefore);

    const withCurrentMeter: PrototypeState = {
      ...renewed.state,
      entities: {
        ...renewed.state.entities,
        properties: renewed.state.entities.properties.map(property =>
          property.id === "building"
            ? {
                ...property,
                meta: { ...property.meta, electricityNumber: "00999" },
              }
            : property
        ),
      },
    };
    const snapshot = refreshRenewalTemplateSnapshot(
      withCurrentMeter,
      renewalLeaseId,
      saved.template.id,
      "b01-renewal-snapshot"
    );
    const refreshedLease = snapshot.state.entities.leases.find(
      lease => lease.id === renewalLeaseId
    )!;
    const refreshedView = getTemplateLeaseView(
      snapshot.state.entities,
      renewalLeaseId
    );

    expect(snapshot.result.meta).toMatchObject({
      recordType: "lease-template-instance",
      snapshotKind: "renewal",
      leaseId: renewalLeaseId,
      templateId: saved.template.id,
      templateVersion: 1,
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      rentMinor: 120_000,
      electricityNumber: "00999",
    });
    expect(
      snapshot.state.entities.documents.filter(
        row => row.meta.parentId === snapshot.result.id
      )
    ).toHaveLength(1);
    expect(refreshedView.content).toContain("الكهرباء: 00999");
    expect(refreshedLease.meta).toMatchObject({
      templateId: saved.template.id,
      templateVersion: 1,
      snapshotDocumentId: snapshot.result.id,
    });
    expect(refreshedLease.meta.newTemplateSnapshotRequired).toBeUndefined();
    expect(documentCount(snapshot.state)).toBe(renewalDocumentsBefore + 2);
    expect(snapshot.state.entities.receivables).toEqual(
      withCurrentMeter.entities.receivables
    );
    expect(snapshot.state.entities.collections).toEqual(
      withCurrentMeter.entities.collections
    );

    const originalAfterSnapshot = getTemplateLeaseView(
      snapshot.state.entities,
      generated.lease.id
    );
    expect(originalAfterSnapshot.document.id).toBe("OLD-DOC");
    expect(originalAfterSnapshot.content).toBe(originalBeforeRenewal.content);
    expect(originalAfterSnapshot.lease.meta.registrationNumber).toBe("OLD-123");
    expect(originalAfterSnapshot.lease.meta.signatureProof).toBe(
      "OLD-SIGNATURE"
    );

    const retry = refreshRenewalTemplateSnapshot(
      snapshot.state,
      renewalLeaseId,
      saved.template.id,
      "b01-renewal-snapshot"
    );
    expect(retry.state).toBe(snapshot.state);
    expect(retry.result.id).toBe(snapshot.result.id);
    expect(documentCount(retry.state)).toBe(documentCount(snapshot.state));

    const activated = activateLease(
      snapshot.state,
      renewalLeaseId,
      "2026-10-24"
    );
    expect(activated.result.status).toBe("نافذ");
    expect(
      activated.state.entities.receivables.filter(
        row => row.meta.leaseId === renewalLeaseId
      )
    ).toHaveLength(12);
    expect(documentCount(activated.state)).toBe(documentCount(snapshot.state));
    expect(activated.state.entities.collections).toEqual(
      snapshot.state.entities.collections
    );

    const activationRetry = activateLease(
      activated.state,
      renewalLeaseId,
      "2026-10-24"
    );
    expect(activationRetry.state).toBe(activated.state);
    expect(
      activationRetry.state.entities.receivables.filter(
        row => row.meta.leaseId === renewalLeaseId
      )
    ).toHaveLength(12);
  });

  it("does not change the renewal when the selected template no longer matches current rent or term", () => {
    const saved = saveLeaseTemplate(fixtureState(), {
      requestId: "b01-mismatch-template",
      name: "قالب بقيمة غير مطابقة",
      content: CONTENT,
      fileName: "mismatch.txt",
      defaultRentMinor: 100_000,
      defaultTermMonths: 12,
    });
    const generated = generateTemplateLease(saved.state, {
      requestId: "b01-mismatch-original",
      templateId: saved.template.id,
      propertyId: "building",
      unitId: "u-b6",
      tenantName: "مستأجر اختبار",
      propertyNumber: "B-21",
      electricityNumber: "00129",
      propertyType: "عمارة",
      startDate: "2026-01-01",
    });
    const active = activateLease(
      generated.state,
      generated.lease.id,
      "2026-10-24"
    );
    const renewed = renewLease(active.state, generated.lease.id, {
      title: "تجديد بقيمة مختلفة",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
      rent: "1200",
      terminatePrevious: "confirm",
      newTemplateStep: "confirm",
      requestId: "b01-mismatch-renewal",
    });
    const before = renewed.state;

    expect(() =>
      refreshRenewalTemplateSnapshot(
        before,
        renewed.result.id,
        saved.template.id,
        "b01-mismatch-snapshot"
      )
    ).toThrow("لا يطابق إيجار أو مدة التجديد الحالية");
    expect(renewed.state).toBe(before);
    expect(documentCount(renewed.state)).toBe(documentCount(before));
    expect(
      renewed.state.entities.leases.find(
        lease => lease.id === renewed.result.id
      )?.meta.snapshotDocumentId
    ).toBeUndefined();
  });
});
