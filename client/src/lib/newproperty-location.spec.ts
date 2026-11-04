import { describe, expect, it } from "vitest";
import {
  makePropertyLocation,
  parsePropertyLocation,
} from "./newproperty-location";
import { makePropertyDraft } from "./property-fields";

const base = {
  title: "فيلا الموقع",
  portfolioId: "family",
  assetType: "villa",
  usageType: "residential",
  rentalMode: "whole",
  unitCount: "1",
};

describe("structured property location", () => {
  it("keeps zone, street and building identifiers as text including Arabic and leading zeroes", () => {
    const raw = makePropertyLocation({
      zoneNumber: "٠٠١",
      streetNumber: "0007",
      buildingNumber: "٠٤٢-A",
      mapUrl: "https://maps.example.test/location?zone=001",
    });
    expect(parsePropertyLocation(raw)).toEqual({
      v: 1,
      zoneNumber: "٠٠١",
      streetNumber: "0007",
      buildingNumber: "٠٤٢-A",
      mapUrl: "https://maps.example.test/location?zone=001",
    });
    expect(makePropertyLocation({})).toBe("");
  });

  it("rejects unsafe URLs, credentials, malformed payloads and overlong identifiers", () => {
    expect(() =>
      makePropertyLocation({ mapUrl: "javascript:alert(1)" })
    ).toThrow("HTTP أو HTTPS");
    expect(() =>
      makePropertyLocation({ mapUrl: "https://user:secret@example.test/map" })
    ).toThrow("دون بيانات دخول");
    expect(() => makePropertyLocation({ zoneNumber: "0".repeat(81) })).toThrow(
      "80"
    );
    expect(() => parsePropertyLocation('{"v":1,"url":"https://bad"}')).toThrow(
      "غير صالحة"
    );
    expect(() =>
      parsePropertyLocation('{"v":1,"mapUrl":"data:text/plain,x"}')
    ).toThrow("غير صالحة");
  });

  it("writes a compact propertyLocation field without replacing the descriptive location text", () => {
    const direct = makePropertyDraft({
      ...base,
      location: "الدوحة · وصف الموقع القديم",
      zoneNumber: "61",
      streetNumber: "00120",
      buildingNumber: "0008",
      mapUrl: "http://maps.example.test/asset",
    });
    expect(direct.location).toBe("الدوحة · وصف الموقع القديم");
    expect(direct.meta.location).toBe("الدوحة · وصف الموقع القديم");
    expect(parsePropertyLocation(direct.meta.propertyLocation)).toEqual({
      v: 1,
      zoneNumber: "61",
      streetNumber: "00120",
      buildingNumber: "0008",
      mapUrl: "http://maps.example.test/asset",
    });

    const packed = makePropertyDraft({
      ...base,
      propertyLocation: JSON.stringify({
        v: 1,
        zoneNumber: "٠٠٥",
        buildingNumber: "0009",
      }),
    });
    expect(parsePropertyLocation(packed.meta.propertyLocation)).toEqual({
      v: 1,
      zoneNumber: "٠٠٥",
      buildingNumber: "0009",
    });

    const clearOnlyStructured = makePropertyDraft({
      ...base,
      location: "وصف محفوظ مستقل",
      propertyLocation: "",
    });
    expect(clearOnlyStructured.meta.location).toBe("وصف محفوظ مستقل");
    expect(clearOnlyStructured.clearMetaKeys).toContain("propertyLocation");
    expect(clearOnlyStructured.clearMetaKeys).not.toContain("location");
  });
});
