export function assetFieldForError(
  message: string,
  unit = false
): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/اسم (العقار|الوحدة)|الاسم.*256|title/i, "title"],
    [/المحفظة|portfolio/i, "portfolioId"],
    [/الرقم.*مكرر|رمز الوحدة|ترقيم|unitCode/i, "unitCode"],
    [/نوع الاستخدام|استخدامًا|usageType/i, "usageType"],
    [/نوع أصل|نوع العقار|assetType/i, "assetType"],
    [/طريقة التأجير|تقسيم|rentalMode/i, "rentalMode"],
    [/عدد الوحدات|unitCount/i, "unitCount"],
    [/سنة البناء|buildingYear/i, "buildingYear"],
    [/مساحة الأرض|landArea/i, "landArea"],
    [/مساحة البناء|مساحة العقار|buildingArea/i, "buildingArea"],
    [/مساحة الوحدة|unitArea/i, "unitArea"],
    [/الدور|floor/i, "floor"],
    [/سعر البيع|salePrice/i, "salePrice"],
    [/الإيجار الشهري الحالي|tenancyMonthlyRent/i, "tenancyMonthlyRent"],
    [/الإيجار|إيجار الوحدة|monthlyRent/i, "monthlyRent"],
    [/اسم بنك الرهن|mortgageBank/i, "mortgageBank"],
    [/رقم العقار|propertyNumber/i, "propertyNumber"],
    [/رقم الكهرباء|عداد|electricityNumber/i, "electricityNumber"],
    [/رقم المخطط|planNumber/i, "planNumber"],
    [/تاريخ بداية|tenancyStartDate/i, "tenancyStartDate"],
    [/تاريخ نهاية|tenancyEndDate/i, "tenancyEndDate"],
    [/تاريخ آخر صيانة|lastMaintenanceDate/i, "lastMaintenanceDate"],
    [/تكلفة آخر صيانة|lastMaintenanceCost/i, "lastMaintenanceCost"],
    [
      /غرف|صالات|صالة|توزيع|سكن|تأثيث|حمامات|مطابخ/i,
      unit ? "roomLayout" : "accommodation",
    ],
    [/محتويات العقار|contents/i, "contents"],
  ];
  return patterns.find(([pattern]) => pattern.test(message))?.[1];
}

export function nativeAssetFieldMessage(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): string {
  const label =
    control
      .closest("label")
      ?.querySelector("span")
      ?.textContent?.replace(/\*/g, "")
      .trim() ||
    control.name ||
    "الحقل";
  if (control.validity.valueMissing) return `${label} مطلوب.`;
  if (control.validity.tooLong) return `${label} يتجاوز الحد المسموح.`;
  return `${label}: أدخل قيمة صحيحة ضمن الحدود الموضحة.`;
}
