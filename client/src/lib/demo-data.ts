import {
  BRAND_ASSETS,
  DemoEntity,
  ENTITY_KINDS,
  EntityKind,
  PrototypeState,
  toMinor,
} from "@shared/prototype";

const make = (
  id: string,
  title: string,
  status = "نشط",
  amount = "0",
  portfolioId = "family",
  propertyId = "",
  meta: DemoEntity["meta"] = {},
  date = "2026-10-01",
  subtitle = ""
): DemoEntity => ({
  id,
  title,
  subtitle,
  status,
  amountMinor: toMinor(amount),
  currency: "QAR",
  portfolioId,
  propertyId,
  meta,
  date,
});

export function createDemoState(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(k => [k, []])
  ) as unknown as Record<EntityKind, DemoEntity[]>;
  entities.portfolios = [
    make("family", "محفظة الأسرة", "نشط", "420000", "family", "", {
      openingMinor: toMinor("420000"),
      depositMinor: toMinor("60000"),
      owner: "أسرة النموذج",
      account: "حساب تجريبي • 0041",
      purpose: "دخل مستقر والمحافظة على الأصل",
    }),
    make("growth", "محفظة النمو", "نشط", "180000", "growth", "", {
      openingMinor: toMinor("180000"),
      depositMinor: toMinor("20000"),
      owner: "شركاء النموذج",
      account: "حساب تجريبي • 0083",
      purpose: "تنمية رأس المال على مراحل",
    }),
  ];
  entities.properties = [
    make(
      "villa",
      "فيلا الروضة",
      "مؤجر",
      "2400000",
      "family",
      "villa",
      {
        type: "فيلا",
        area: 420,
        location: "الدوحة • منطقة نموذجية",
        image: BRAND_ASSETS.villa,
        year: 2018,
        account: "0041",
        monthlyRentMinor: toMinor("12000"),
      },
      "2026-01-01",
      "مثال عقار خيالي · ليس إعلانًا حقيقيًا"
    ),
    make(
      "building",
      "عمارة المها",
      "مؤجر جزئيًا",
      "6200000",
      "family",
      "building",
      {
        type: "عمارة سكنية",
        area: 1800,
        location: "لوسيل • منطقة نموذجية",
        image: BRAND_ASSETS.apartments,
        year: 2021,
        account: "0041",
        monthlyRentMinor: toMinor("27000"),
      },
      "2026-01-01",
      "مثال عقار خيالي · صورة مولّدة"
    ),
    make(
      "tower",
      "وحدات برج الأفق",
      "مؤجر جزئيًا",
      "3800000",
      "growth",
      "tower",
      {
        type: "شقق",
        area: 580,
        location: "الخليج الغربي • مثال",
        image: BRAND_ASSETS.tower,
        year: 2023,
        account: "0083",
        monthlyRentMinor: toMinor("19500"),
      },
      "2026-01-01",
      "مثال عقار خيالي · صورة مولّدة"
    ),
  ];
  entities.units = [
    make("u-v1", "الوحدة V-01", "مؤجرة", "12000", "family", "villa", {
      rooms: 5,
      area: 420,
    }),
  ];
  for (let n = 1; n <= 6; n++)
    entities.units.push(
      make(
        `u-b${n}`,
        `شقة M-0${n}`,
        n === 6 ? "شاغرة" : "مؤجرة",
        "4500",
        "family",
        "building",
        { rooms: 2, area: 110 }
      )
    );
  for (let n = 1; n <= 3; n++)
    entities.units.push(
      make(
        `u-t${n}`,
        `شقة H-0${n}`,
        n === 3 ? "قيد التجهيز" : "مؤجرة",
        "6500",
        "growth",
        "tower",
        { rooms: 3, area: 145 }
      )
    );
  const occupied = entities.units.filter(x => x.status === "مؤجرة");
  const names = [
    "مستأجر النموذج أ",
    "مستأجر النموذج ب",
    "مستأجر النموذج ج",
    "مستأجر النموذج د",
    "مستأجر النموذج هـ",
    "مستأجر النموذج و",
    "مستأجر النموذج ز",
    "مستأجر النموذج ح",
  ];
  occupied.forEach((unit, i) => {
    const tenantId = `tenant-${i + 1}`;
    const leaseId = `lease-${i + 1}`;
    entities.tenants.push(
      make(tenantId, names[i], "نشط", "0", unit.portfolioId, unit.propertyId, {
        email: `tenant${i + 1}@example.invalid`,
        phone: "رقم تجريبي غير قابل للاتصال",
        unitId: unit.id,
      })
    );
    entities.leases.push({
      ...unit,
      id: leaseId,
      title: `عقد ${unit.title}`,
      subtitle: names[i],
      date: "2026-01-01",
      status: "نافذ",
      meta: {
        unitId: unit.id,
        tenantId,
        tenant: names[i],
        start: "2026-01-01",
        end: i === 2 ? "2026-11-01" : "2026-12-31",
        registrationStatus:
          i === 1 ? "طلب قيد الإجراء" : i === 3 ? "غير مسجل" : "مسجل",
        registrationNumber:
          i === 1 ? "طلب تجريبي REG-102" : `REG-DEMO-${i + 1}`,
        registrationDate: "2026-01-15",
        version: 1,
        method: "شهري",
      },
    });
    entities.receivables.push({
      ...unit,
      id: `r-${i + 1}`,
      title: `إيجار أكتوبر • ${unit.title}`,
      subtitle: names[i],
      date: "2026-10-01",
      status: "مستحق",
      meta: {
        leaseId,
        unitId: unit.id,
        tenantId,
        tenant: names[i],
        due: "2026-10-01",
      },
    });
    if (i < 5)
      entities.collections.push({
        ...unit,
        id: `c-${i + 1}`,
        title: `تحصيل ${unit.title}`,
        subtitle: names[i],
        status: "محصّل",
        date: "2026-10-05",
        meta: {
          receivableId: `r-${i + 1}`,
          method: i === 2 ? "شيك" : "تحويل",
          received: "2026-10-02",
          deposited: "2026-10-03",
          cleared: "2026-10-05",
        },
      });
    if (i === 5)
      entities.collections.push({
        ...unit,
        id: "c-partial",
        title: "تحصيل جزئي • M-05",
        status: "محصّل",
        amountMinor: toMinor("2000"),
        date: "2026-10-08",
        meta: { receivableId: `r-${i + 1}`, method: "تحويل" },
      });
    if (i === 6)
      entities.collections.push({
        ...unit,
        id: "check-pending",
        title: "شيك • H-01",
        status: "مودع",
        date: "2026-10-11",
        meta: {
          receivableId: `r-${i + 1}`,
          method: "شيك",
          received: "2026-10-08",
          deposited: "2026-10-11",
        },
      });
  });
  for (let month = 5; month < 10; month++) {
    occupied.forEach((unit, i) => {
      entities.collections.push({
        ...unit,
        id: `history-${month}-${i}`,
        title: `تحصيل سابق • ${unit.title}`,
        status: "محصّل",
        date: `2026-${String(month).padStart(2, "0")}-05`,
        meta: { method: "تحويل", historical: true },
      });
    });
  }
  entities.losses = [
    make(
      "loss-1",
      "خسارة تحصيل سابقة",
      "مسجلة",
      "1800",
      "family",
      "building",
      {
        reason: "حالة تدريبية لمطالبة سابقة تعذر تحصيلها",
        receivableId: "previous-demo",
        recordedBy: "موظف النموذج",
      },
      "2026-10-02"
    ),
  ];
  entities.collections.push(
    make(
      "recovery-1",
      "استرداد خسارة سابقة",
      "محصّل",
      "600",
      "family",
      "building",
      { recoveryParent: "loss-1", method: "تحويل", type: "استرداد" },
      "2026-10-15"
    )
  );
  entities.expenses = [
    make(
      "ex1",
      "صيانة تكييف",
      "مسدد",
      "3200",
      "family",
      "building",
      {
        category: "صيانة تشغيلية",
        vendor: "مورد النموذج أ",
        documentId: "doc2",
        method: "بنك",
      },
      "2026-10-03"
    ),
    make(
      "ex2",
      "تنظيف المرافق",
      "مسدد",
      "1800",
      "family",
      "building",
      { category: "تشغيلي", vendor: "مورد النموذج ب", method: "بنك" },
      "2026-10-07"
    ),
    make(
      "ex3",
      "عقد خدمة مصعد",
      "مسدد",
      "2500",
      "growth",
      "tower",
      { category: "صيانة تشغيلية", vendor: "مورد النموذج ج", method: "بنك" },
      "2026-10-08"
    ),
    make(
      "ex4",
      "إصلاح واجهة مقترح",
      "بانتظار الاعتماد",
      "7000",
      "family",
      "villa",
      { category: "تحسين رأسمالي", vendor: "مورد النموذج أ" },
      "2026-10-19"
    ),
    make(
      "ex5",
      "فائدة تمويل نموذجية",
      "مسدد",
      "900",
      "growth",
      "tower",
      { category: "فائدة تمويل", method: "بنك" },
      "2026-10-12"
    ),
  ];
  for (let month = 5; month < 10; month++)
    entities.expenses.push(
      make(
        `ex-history-${month}`,
        "مصروفات تشغيل سابقة",
        "مسدد",
        "6400",
        "family",
        "building",
        { category: "تشغيلي", historical: true },
        `2026-${String(month).padStart(2, "0")}-11`
      )
    );
  entities.reserves = [
    make("reserve-1", "احتياطي الصيانة", "مخصص", "40000", "family"),
    make("reserve-2", "احتياطي النمو", "مخصص", "15000", "growth"),
  ];
  entities.liabilities = [
    make(
      "liab-1",
      "التزام خدمة قادم",
      "قائم",
      "2500",
      "family",
      "building",
      { type: "تشغيلي", due: "2026-11-05" },
      "2026-11-05"
    ),
    make(
      "loan-1",
      "قرض نموذجي · أصل قائم",
      "قائم",
      "250000",
      "growth",
      "tower",
      {
        type: "قرض",
        principalMinor: toMinor("250000"),
        installmentMinor: toMinor("6000"),
        interestMinor: toMinor("900"),
      },
      "2026-11-01"
    ),
  ];
  entities.budgets = [
    make("budget-1", "ميزانية تشغيل أكتوبر", "معتمدة", "10000", "family", "", {
      category: "تشغيل",
      period: "2026-10",
    }),
    make("budget-2", "ميزانية تشغيل أكتوبر", "معتمدة", "6500", "growth", "", {
      category: "تشغيل",
      period: "2026-10",
    }),
  ];
  entities.bankTransactions = [
    make(
      "bank1",
      "تحويل مستأجر النموذج أ",
      "غير مطابق",
      "12000",
      "family",
      "villa",
      { direction: "داخل", reference: "DEMO-T001", collectionId: "c-1" },
      "2026-10-05"
    ),
    make(
      "bank2",
      "صيانة تكييف",
      "مطابق",
      "3200",
      "family",
      "building",
      { direction: "خارج", reference: "DEMO-T002", expenseId: "ex1" },
      "2026-10-03"
    ),
    make(
      "bank3",
      "تحويل يحتاج مراجعة",
      "غير مطابق",
      "1500",
      "family",
      "",
      { direction: "داخل", reference: "DEMO-T003" },
      "2026-10-17"
    ),
  ];
  entities.payments = [
    make(
      "payment1",
      "مطالبة H-02",
      "بانتظار الدفع",
      "6500",
      "growth",
      "tower",
      {
        receivableId: "r-8",
        feeMinor: 0,
        provider: "مزود غير متصل",
        simulation: true,
      }
    ),
  ];
  entities.documents = [
    make(
      "doc1",
      "عقد فيلا الروضة · نسخة نموذجية",
      "صالح",
      "0",
      "family",
      "villa",
      {
        type: "عقد",
        version: 1,
        expires: "2026-12-31",
        file: "عقد تجريبي · لا بيانات شخصية",
        retention: "سياسة تجريبية",
      }
    ),
    make("doc2", "إيصال صيانة · نموذج", "صالح", "3200", "family", "building", {
      type: "إيصال",
      version: 1,
      expires: "2027-10-01",
      extraction: "بانتظار المراجعة",
    }),
    make("doc3", "ضمان مصعد · نموذج", "قريب الانتهاء", "0", "growth", "tower", {
      type: "ضمان",
      version: 2,
      expires: "2026-11-10",
    }),
  ];
  entities.vacancies = [
    make(
      "vac1",
      "شقة M-06",
      "جاهزة للتسويق",
      "4500",
      "family",
      "building",
      {
        unitId: "u-b6",
        reason: "انتهاء عقد سابق",
        since: "2026-09-10",
        lostIncomeMinor: toMinor("4500"),
      },
      "2026-09-10"
    ),
    make("vac2", "شقة H-03", "قيد التجهيز", "6500", "growth", "tower", {
      unitId: "u-t3",
      reason: "إصلاح قبل الإشغال",
      since: "2026-10-01",
      lostIncomeMinor: toMinor("6500"),
    }),
  ];
  entities.vendors = [
    make("vendor1", "مورد النموذج أ", "معتمد", "0", "family", "", {
      skill: "تكييف وسباكة",
      area: "الدوحة",
      available: true,
      jobs: 18,
      responseHours: 3,
      completionRate: 94,
      reopens: 1,
    }),
    make("vendor2", "مورد النموذج ب", "معتمد", "0", "family", "", {
      skill: "تنظيف وصيانة عامة",
      area: "لوسيل",
      available: true,
      jobs: 12,
      responseHours: 2,
      completionRate: 92,
      reopens: 1,
    }),
    make("vendor3", "مورد النموذج ج", "معتمد", "0", "growth", "", {
      skill: "مصاعد وكهرباء",
      area: "الخليج الغربي",
      available: false,
      jobs: 7,
      responseHours: 4,
      completionRate: 86,
      reopens: 0,
    }),
  ];
  entities.maintenance = [
    make(
      "work1",
      "تسريب في شقة M-02",
      "بانتظار الموافقة",
      "850",
      "family",
      "building",
      {
        unitId: "u-b2",
        vendorId: "vendor1",
        priority: "عاجل",
        assignedTo: "مورد النموذج أ",
        limitMinor: toMinor("500"),
        quote1Minor: toMinor("850"),
        quote2Minor: toMinor("1100"),
        due: "2026-10-25",
        proof: false,
      },
      "2026-10-24"
    ),
    make(
      "work2",
      "فحص تكييف فيلا الروضة",
      "قيد التنفيذ",
      "400",
      "family",
      "villa",
      {
        vendorId: "vendor1",
        priority: "عادي",
        assignedTo: "مورد النموذج أ",
        limitMinor: toMinor("500"),
        due: "2026-10-26",
        proof: false,
      },
      "2026-10-23"
    ),
    make("work3", "تجهيز شقة H-03", "جديد", "1200", "growth", "tower", {
      unitId: "u-t3",
      vendorId: "vendor3",
      priority: "متوسط",
      due: "2026-10-28",
    }),
  ];
  entities.preventive = [
    make(
      "pre1",
      "فحص المصعد الدوري",
      "مجدول",
      "600",
      "growth",
      "tower",
      {
        frequency: "شهري",
        next: "2026-11-01",
        asset: "مصعد نموذجي",
        warranty: "2026-11-10",
      },
      "2026-11-01"
    ),
    make(
      "pre2",
      "تنظيف خزانات المياه",
      "مجدول",
      "900",
      "family",
      "building",
      {
        frequency: "ربع سنوي",
        next: "2026-11-15",
        asset: "خزان المبنى",
        warranty: "2027-01-01",
      },
      "2026-11-15"
    ),
  ];
  entities.inspections = [
    make(
      "in1",
      "استلام M-03",
      "مكتمل",
      "0",
      "family",
      "building",
      {
        unitId: "u-b3",
        type: "دخول",
        living: "سليم",
        kitchen: "سليم",
        bathroom: "ملاحظة بسيطة",
        image: BRAND_ASSETS.apartments,
        inspector: "موظف النموذج",
        acknowledgement: true,
      },
      "2026-01-01"
    ),
    make(
      "in2",
      "تسليم M-06",
      "بانتظار المراجعة",
      "0",
      "family",
      "building",
      {
        unitId: "u-b6",
        type: "خروج",
        living: "دهان يحتاج مراجعة",
        kitchen: "سليم",
        bathroom: "سليم",
        image: BRAND_ASSETS.apartments,
        inspector: "موظف النموذج",
        depositDecision: "لم يعتمد",
      },
      "2026-09-10"
    ),
  ];
  entities.disputes = [
    make(
      "case1",
      "مطالبة إيجارية نموذجية",
      "قيد المتابعة",
      "1800",
      "family",
      "building",
      {
        lawyer: "مستشار قانوني للنموذج",
        next: "2026-10-28",
        type: "مطالبة",
        expectedImpact: "أثر محتمل فقط",
        action: "مراجعة المستندات",
      },
      "2026-10-28"
    ),
  ];
  entities.tasks = [
    make(
      "task1",
      "مراجعة تجديد عقد M-02",
      "بانتظار قرار",
      "0",
      "family",
      "building",
      {
        owner: "موظف النموذج",
        priority: "عاجل",
        due: "2026-10-26",
        source: "عقد",
      },
      "2026-10-26"
    ),
    make(
      "task2",
      "اعتماد عرض تسريب M-02",
      "جديد",
      "0",
      "family",
      "building",
      {
        owner: "صاحب القرار",
        priority: "عاجل",
        due: "2026-10-25",
        source: "صيانة",
      },
      "2026-10-25"
    ),
    make(
      "task3",
      "استكمال مستند تسجيل العقد",
      "قيد التنفيذ",
      "0",
      "family",
      "building",
      {
        owner: "موظف النموذج",
        priority: "متوسط",
        due: "2026-10-27",
        source: "تسجيل",
      },
      "2026-10-27"
    ),
    make(
      "task4",
      "تجهيز شقة H-03 للتسويق",
      "جديد",
      "0",
      "growth",
      "tower",
      {
        owner: "مورد النموذج ج",
        priority: "متوسط",
        due: "2026-10-28",
        source: "شغور",
      },
      "2026-10-28"
    ),
  ];
  entities.notifications = [
    make(
      "notice1",
      "موعد عقد قريب",
      "داخل التطبيق",
      "0",
      "family",
      "building",
      {
        channel: "داخل التطبيق",
        template: "مراجعة التجديد",
        consent: true,
        recipient: "موظف النموذج",
        delivered: true,
      }
    ),
    make(
      "notice2",
      "تذكير مهمة صيانة",
      "قالب محفوظ",
      "0",
      "family",
      "building",
      {
        channel: "واتساب · محاكاة",
        template: "موعد زيارة",
        consent: false,
        recipient: "مستأجر النموذج ب",
        delivered: false,
      }
    ),
  ];
  entities.members = [
    make("member1", "موظف النموذج", "نشط", "0", "family", "", {
      role: "operator",
      scope: "محفظة الأسرة",
      canApprove: false,
    }),
    make("member2", "صاحب قرار النموذج", "نشط", "0", "family", "", {
      role: "owner",
      scope: "محفظة الأسرة",
      canApprove: true,
    }),
    make("member3", "مراجع النموذج", "نشط", "0", "growth", "", {
      role: "reviewer",
      scope: "قراءة فقط",
      canApprove: false,
    }),
  ];
  entities.owners = [
    make("owner1", "شريك النموذج أ", "نشط", "0", "family", "", {
      share: 60,
      effective: "2026-01-01",
    }),
    make("owner2", "شريك النموذج ب", "نشط", "0", "family", "", {
      share: 40,
      effective: "2026-01-01",
    }),
    make("owner3", "شريك النموذج ج", "نشط", "0", "growth", "", {
      share: 100,
      effective: "2026-01-01",
    }),
  ];
  entities.contributions = [
    make(
      "con1",
      "مساهمة شريك النموذج أ",
      "موثقة",
      "150000",
      "family",
      "",
      { ownerId: "owner1" },
      "2026-01-01"
    ),
  ];
  entities.distributions = [
    make(
      "dist1",
      "توزيع أرباح سبتمبر المقترح",
      "بانتظار الاعتماد",
      "12000",
      "family",
      "",
      { period: "2026-09", transfer: false }
    ),
  ];
  entities.listings = [
    make(
      "listing1",
      "شقة M-06 للإيجار · نموذج",
      "مسودة",
      "4500",
      "family",
      "building",
      {
        unitId: "u-b6",
        rooms: 2,
        area: 110,
        image: BRAND_ASSETS.apartments,
        leads: 3,
        consent: false,
      }
    ),
  ];
  entities.applications = [
    make(
      "app1",
      "متقدم النموذج أ",
      "قيد المراجعة",
      "4500",
      "family",
      "building",
      {
        listingId: "listing1",
        consent: true,
        completeness: 80,
        email: "applicant@example.invalid",
        criteria: "استكمال الوثائق والشروط المعلنة",
      }
    ),
    make(
      "app2",
      "متقدم النموذج ب",
      "بانتظار مستند",
      "4500",
      "family",
      "building",
      {
        listingId: "listing1",
        consent: true,
        completeness: 60,
        email: "sample@example.invalid",
      }
    ),
  ];
  entities.signatures = [
    make("sig1", "عقد M-06 · نموذج توقيع", "مسودة", "0", "family", "building", {
      template: "قالب عربي/إنجليزي نموذجي",
      landlord: "صاحب قرار النموذج",
      tenant: "متقدم النموذج أ",
      version: 1,
      registration: false,
    }),
  ];
  entities.comparables = [
    make(
      "comp1",
      "عينة شقة 2 غرف · مثال أ",
      "إعلان صوري",
      "4300",
      "family",
      "building",
      {
        area: 105,
        rooms: 2,
        region: "لوسيل",
        source: "بيانات نموذجية غير سوقية",
        evidence: "إعلان",
        sampleSize: 18,
        confidence: "توضيحي",
      }
    ),
    make(
      "comp2",
      "عينة شقة 2 غرف · مثال ب",
      "عقد صوري",
      "4700",
      "family",
      "building",
      {
        area: 115,
        rooms: 2,
        region: "لوسيل",
        source: "بيانات نموذجية غير سوقية",
        evidence: "عقد",
        sampleSize: 18,
        confidence: "توضيحي",
      }
    ),
    make(
      "comp3",
      "عينة فيلا · مثال",
      "إعلان صوري",
      "12500",
      "family",
      "villa",
      {
        area: 400,
        rooms: 5,
        region: "الدوحة",
        source: "بيانات نموذجية غير سوقية",
        evidence: "إعلان",
        sampleSize: 3,
        confidence: "بيانات غير كافية",
      }
    ),
    make(
      "comp4",
      "عينة شقة 3 غرف · مثال",
      "عقد صوري",
      "6800",
      "growth",
      "tower",
      {
        area: 145,
        rooms: 3,
        region: "الخليج الغربي",
        source: "بيانات نموذجية غير سوقية",
        evidence: "عقد",
        sampleSize: 12,
        confidence: "توضيحي",
      }
    ),
  ];
  entities.plans = [
    make(
      "plan1",
      "مسار دخل متدرج · نموذج",
      "خطة تجريبية",
      "60000",
      "family",
      "",
      {
        years: 5,
        currentIncomeMinor: toMinor("47500"),
        livingMinor: toMinor("12000"),
        savingsMinor: toMinor("8000"),
        targetMinor: toMinor("60000"),
        risk: "متوسط",
        version: 1,
        stage: "ضبط التشغيل",
        source: "حساب محلي توضيحي لا توصية",
      }
    ),
  ];
  entities.reviews = [
    make(
      "review1",
      "مراجعة أكتوبر · نموذج",
      "معتمدة كنموذج",
      "0",
      "family",
      "",
      {
        planId: "plan1",
        reason: "تأجيل أصل جديد لحين تخفيض الشغور",
        version: 1,
      }
    ),
  ];
  entities.opportunities = [
    make(
      "opp1",
      "قطعة أرض للتطوير · مثال",
      "تحتاج فحصًا",
      "780000",
      "growth",
      "",
      {
        type: "أرض",
        region: "منطقة نموذجية",
        source: "فرصة خيالية للبروتوتايب",
        expectedValueMinor: toMinor("1150000"),
        rehabMinor: toMinor("160000"),
        feesMinor: toMinor("25000"),
        rentMinor: toMinor("0"),
        risk: "مرتفع",
        score: 72,
        dataComplete: true,
        image: BRAND_ASSETS.villa,
      }
    ),
    make(
      "opp2",
      "شقة دخل منتظم · مثال",
      "مناسبة للمقارنة",
      "650000",
      "growth",
      "",
      {
        type: "شقة",
        region: "منطقة نموذجية",
        source: "فرصة خيالية للبروتوتايب",
        expectedValueMinor: toMinor("730000"),
        rehabMinor: toMinor("15000"),
        feesMinor: toMinor("12000"),
        rentMinor: toMinor("4800"),
        risk: "متوسط",
        score: 84,
        dataComplete: true,
        image: BRAND_ASSETS.apartments,
      }
    ),
    make(
      "opp3",
      "فيلا ناقصة التشطيب · مثال",
      "بيانات غير كافية",
      "1400000",
      "family",
      "",
      {
        type: "تطوير",
        source: "فرصة خيالية للبروتوتايب",
        expectedValueMinor: toMinor("1900000"),
        rehabMinor: toMinor("220000"),
        feesMinor: toMinor("45000"),
        rentMinor: toMinor("12000"),
        risk: "مرتفع",
        score: 51,
        dataComplete: false,
        image: BRAND_ASSETS.villa,
      }
    ),
  ];
  entities.sources = [
    make("src1", "استيراد العميل", "متاح كنموذج", "0", "family", "", {
      country: "قطر",
      license: "بيانات يملكها العميل · مثال",
      cadence: "يدوي",
      updated: "2026-10-24",
      scope: "عقود الأسرة",
      type: "داخلي",
    }),
    make("src2", "مؤشرات عقارية رسمية", "غير متصل", "0", "family", "", {
      country: "قطر",
      license: "يلزم تحقق حقوق الاستخدام",
      cadence: "حسب الاتفاق",
      scope: "مؤشرات مجمعة",
      type: "خارجي",
    }),
    make("src3", "RentCast", "خارج نطاق قطر", "0", "growth", "", {
      country: "الولايات المتحدة",
      license: "لم يتم التعاقد",
      scope: "لا بيانات قطرية مفترضة",
      type: "خارجي",
    }),
  ];
  entities.quality = [
    make(
      "q1",
      "عقد بلا إثبات تسجيل",
      "يحتاج معالجة",
      "0",
      "family",
      "building",
      { severity: "متوسط", entityId: "lease-4", type: "نقص" }
    ),
    make(
      "q2",
      "عينة فيلا صغيرة",
      "يمنع التوصية الواثقة",
      "0",
      "family",
      "villa",
      { severity: "مرتفع", entityId: "comp3", type: "عينة" }
    ),
    make(
      "q3",
      "مراجعة تغيير حساب تحصيل",
      "بانتظار معتمد مستقل",
      "0",
      "growth",
      "",
      { severity: "مرتفع", type: "تغيير حساس", selfApproval: false }
    ),
  ];
  entities.funding = [
    make(
      "fund1",
      "حزمة تمويل أصل جديد · نموذج",
      "قيد التجهيز",
      "650000",
      "growth",
      "",
      {
        opportunityId: "opp2",
        consent: false,
        completeness: 60,
        incomeStatement: true,
        ownershipProof: true,
        appraisal: false,
        offer: false,
        partner: "شريك لم يحدد",
        sent: false,
      }
    ),
  ];
  entities.subscriptions = [
    make("sub1", "باقة إدارة ونمو · معاينة", "تجريبية", "0", "family", "", {
      plan: "احترافية",
      billing: "سنوي",
      limit: 50,
      price: "الأسعار لم تعتمد",
      setup: "اختياري",
      rentFundsSeparated: true,
    }),
  ];
  return {
    version: 1,
    entities,
    audit: [
      {
        id: "audit-initial",
        at: "2026-10-24T09:00:00Z",
        title: "بدء بيانات البروتوتايب",
        detail: "أمثلة خيالية فقط، جميع الخدمات الخارجية غير متصلة",
      },
    ],
    settings: {
      role: "operator",
      portfolioId: "all",
      period: "2026-10",
      language: "ar",
    },
  };
}

/** A real account's starting workspace: same shape as the demo, no fictional seed data. */
export function createEmptyState(): PrototypeState {
  const entities = Object.fromEntries(
    ENTITY_KINDS.map(k => [k, []])
  ) as unknown as Record<EntityKind, DemoEntity[]>;
  return {
    version: 1,
    entities,
    audit: [],
    settings: {
      role: "operator",
      portfolioId: "all",
      period: "2026-10",
      language: "ar",
    },
  };
}
