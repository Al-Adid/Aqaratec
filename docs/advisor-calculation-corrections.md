# تصحيحات حسابات المستشار وقنّاص الفرص (R01–R04)

هذا التغيير محصور في محرك الحسابات المحلي وبيانات الاختبار المصطنعة. لا يربط بنوكًا أو جهات تمويل أو سوقًا أو بيانات فعلية، ولا يقدّم موافقة أو ضمان عائد.

## قبل / بعد

| الموضوع | السلوك السابق | السلوك المصحح |
| --- | --- | --- |
| R01: تمويل الصفقة | حُسب `cashRequiredMinor = totalCost - loanPrincipal`، ثم قورن بالنقد **مع القرض نفسه**؛ لذلك قد يظهر قرض واحد مرتين. | توازن `funding` مصادر واستخدامات الصفقة. التمويل المعتمد المطبق هو `min(deal.loanPrincipalMinor, brief.approvedFinancingMinor)` مرة واحدة فقط، والنقد المطبق لا يتجاوز الاستخدام المتبقي. العجز لا يصبح سالبًا. |
| R01: التمويل المحتمل | قد يدخل السعة الشرطية ويحوّل الصفقة إلى ملائمة ماليًا. | يعرض منفصلًا في `appliedPotentialFinancingMinor` و`conditionalFundingGapMinor`، لكنه لا يدخل `financiallyFit` ولا يلغي `fundingGapMinor` المؤكد. |
| R02: الثروة السالبة | كان `Math.max(0, netWorth)` يمحو الدين من أساس الهدف. | `initialGoalBasisMinor` يحتفظ بصافي الثروة الموقّع. مثال: −100,000 مع 1,000 شهريًا لمدة 12 شهرًا ينتهي عند −88,000، وفجوة هدف +10,000 هي 98,000. |
| R03: متوسط التشغيل | قُسم صافي التحصيل على الأشهر التي فيها حركة فقط، فاختفت الأشهر الصفرية. | نافذة الملاحظة صريحة وشاملة للطرفين؛ الافتراضي آخر 12 شهرًا المنتهية في `dataDate`. مثال تحصيل 12,000 في يناير و12,000 في ديسمبر = متوسط نقد مرصود 2,000 شهريًا، لا 12,000. |
| R03: الاستدامة | دخل التحصيل المؤكد مباشرة في توقع الفائض حتى إذا كان متأخرًا أو مجمعًا أو غير مربوط. | يفصل المحرك متوسط النقد المرصود عن التوقع التشغيلي المستدام. يلزم تحصيل مربوط باستحقاق في شهره وموسوم بالدورية؛ تستبعد الاستردادات والودائع والتحصيلات المتأخرة والمجمعة وغير المربوطة. عندما لا تكفي التغطية، لا يدخل المتوسط في التوقع وتظهر تنبيهات التغطية. |
| R04: هدف الفرصة | كان اسم الهدف موجودًا في الموجز دون تغيير المطابقة الفعلية، ويمكن للأدلة أن ترفع درجة صفقة خاسرة. | `economicEligibility` يطبق شرطًا اقتصاديًا خاصًا بكل هدف. فشل الاقتصاد يجعل الدرجة صفرًا؛ نقص دليل الاقتصاد يبقي الدرجة منخفضة حتى لو اكتملت أدلة السجل العامة. |

## عقد الإدخال الجديد

`AdvisorProfile` يقبل الحقلين الاختياريين التاليين:

```ts
operatingWindowStart?: string // YYYY-MM، شامل
operatingWindowEnd?: string   // YYYY-MM، شامل
```

- إذا لم يرسلا، تكون النافذة آخر 12 شهرًا والمنتهية في شهر `dataDate`.
- إذا أرسل أحدهما فقط، يبقى الطرف الآخر افتراضيًا (`end = dataDate` أو `start = end - 11 months`).
- يجب ألا تسبق النهاية البداية، والحد الحالي 120 شهرًا للحماية من إدخال غير معقول.
- تحفظ الحقول وتستعاد من metadata للملف الشخصي.

## عقد التشخيص الجديد للواجهة

ينتج `diagnoseAdvisor()` نوعًا كاملاً (`CalculatedAdvisorDiagnosis`) يضمن:

```ts
{
  initialGoalBasisMinor: number, // موقع؛ قد يكون سالبًا لهدف wealth
  operatingEstimate: {
    period: { start: "YYYY-MM", end: "YYYY-MM" },
    months: number,
    totalCashMinor: number,
    averageMinor: number,
    confirmedObservedCashAverageMinor: number,
    sustainableMonthlyOperatingMinor: number,
    coverage: {
      observedMonths: number,
      zeroCashMonths: number,
      recurringIncomeMonths: number,
      recurringExpenseMonths: number,
    },
    excludedFlows: Array<{
      kind: "arrears" | "bulk" | "deposit" | "recovery" | "unlinked" | "unclassifiedExpense",
      label: string,
      amountMinor: number,
      count: number,
    }>,
    reliability: "insufficient" | "limited" | "sufficient",
  },
}
```

`AdvisorDiagnosis` يبقي هذين الحقلين اختياريين فقط لتوافق عنصر واجهة قديم يعرض نتيجة بديلة أثناء غياب المحفظة. عند وجود نتيجة `diagnoseAdvisor()` الفعلية فهما موجودان دائمًا.

### قواعد عرض التشغيل

- اعرض `confirmedObservedCashAverageMinor` كمتوسط نقد تاريخي مرصود، لا كتوقع.
- اعرض `sustainableMonthlyOperatingMinor` فقط كتقدير تشغيل مشروط بالدورية والتغطية.
- عندما `reliability !== "sufficient"`، لا تضف المتوسط المرصود إلى توقع الدخل أو الفائض؛ اعرض `coverage` و`alerts` و`excludedFlows` بدلًا من ذلك.
- لا تستنتج عائدًا أو إيجارًا أو سعر سوق من هذه الحقول.

## عقد تقييم القنّاص الجديد للواجهة

كل `HunterEvaluation` يعيد الحقول التالية إضافة إلى الحقول القديمة:

```ts
{
  financiallyFit: boolean,
  reasons: string[],
  funding: {
    usesMinor: number,
    requestedFacilityMinor: number,
    cashSourceMinor: number,
    appliedConfirmedFinancingMinor: number,
    potentialFinancingMinor: number,
    appliedPotentialFinancingMinor: number,
    confirmedSourcesMinor: number,
    conditionalSourcesMinor: number,
    fundingGapMinor: number,
    conditionalFundingGapMinor: number,
  },
  economicEligibility: {
    goal: "wealth" | "income" | "debt" | "home",
    eligible: boolean,
    viable: boolean,
    reasons: string[],
    missing: string[],
    criteria: Array<{
      id: string,
      label: string,
      met: boolean | null,
      amountMinor?: number,
    }>,
  },
}
```

### قواعد العرض والقرار

- `fundingGapMinor` هو العجز المؤكد غير السالب؛ `financiallyFit` صحيح فقط عندما يساوي صفرًا. لا يعالج التمويل المحتمل هذا العلم.
- `conditionalFundingGapMinor` يشرح أثر تمويل محتمل غير مؤكد فقط. لا تعرضه كموافقة أو قدرة مؤكدة.
- `reasons` يشرح الرفض الحاسم، و`missing` يشرح ما يحتاج تحققًا أو دليلًا إضافيًا.
- لا تستخدم `score` منفردًا لاتخاذ قرار: الملاءمة الاقتصادية والدليل منفصلان.

### شروط الاقتصاد حسب الهدف

| الهدف | الشرط الاقتصادي |
| --- | --- |
| `wealth` | `resultMinor > 0` بعد جميع التكاليف؛ نتيجة غير موجبة ترفض الاقتصاد ودرجتها صفر. |
| `income` | `monthlyNetRentMinor > 0` بعد الشغور والتشغيل؛ صفر الإيجار أو صافي غير موجب لا يصبح جيدًا بكثرة الأدلة. |
| `home` | يلزم `residenceEligible`/`residenceVerified` و`affordabilityVerified`/`affordabilityEligible` صراحة في metadata. يمكن أن تجتاز فرصة سكنية خسارة محاسبية إذا استوفت هذين الشرطين، لكنها لا يمكن أن تكون ممولة ماليًا بعجز مؤكد. |
| `debt` | يلزم `debtBenefitMinor` موثقًا و`debtBenefitVerified` (أو `paydownVerified`/`refinanceVerified`). تطرح `financingCostMinor` من الفائدة المعلنة؛ لا تكفي الميزانية وحدها. |

## تحقق التنفيذ

- RED قبل الإصلاح: `reports/correction-audit/engine-red.log` — خمس حالات فاشلة متوقعة على المحرك الأساسي.
- GREEN بعد الإصلاح: `reports/correction-audit/engine-green.log` — 17 اختبارًا ناجحًا (التصحيحات الجديدة واختبارات المحرك والأهداف القائمة).
- لم تُعدّل `calculateDeal` في مكونات التكلفة أو معاملة أصل القرض كمصدر لا كمصروف، ولم تتغير حراسة مدخلات الضغط.
