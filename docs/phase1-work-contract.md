# عقد العمل لجولة إغلاق إدارة العقارات

المرجع docs/phase1-order-ar.md، الأساس 86b53cf، نسخة مجمدة للقراءة/المسبارات /home/ubuntu/reports/phase1-closure/baseline. لا بحث خارجي/مزود/نشر/هجرة/بيانات فعلية. لا تعدل ملفات يمتلكها فريق آخر. سجلات red/green في /home/ubuntu/reports/phase1-closure/evidence، تقرير فريقك في docs/phase1-<team>.md. احفظ المنطق والاختبارات السابقة للمؤجل، ولا تحذف كودًا.

- lifecycle: prototype-lease-lifecycle.ts + lease-template-engine.ts + LeaseCollectionPages.tsx واختباراتها. صدّر unitOccupancyAt(entities:EntityMap,unitId:string,asOf:string): 'occupied'|'vacant'|'reserved'|'unavailable'. انتقالاتكم ذرية من PrototypeState إلى PrototypeState، UI يستخدم commitTransition.
- property: property-fields.ts + prototype-rental.ts + PortfolioPropertyPages.tsx + ContractTemplatesPage.tsx وCSS الخاصة واختباراتها. صدّر electricityNumberForRentalTarget(entities:EntityMap,propertyId:string,unitId?:string):string، مع مرجعية وراثة صريحة. لا تعديل lease-template-engine المملوك لدورة العقد. تحديث العقار ذري عبر commitTransition/helper لا generic patch على خطوات.
- finance: prototype-finance.ts + prototype-budget.ts + FinancePages.tsx + ReportsVacancyPages.tsx واختباراتها، دون واجهة مطابقة متقدمة جديدة. التاريخية وفصل الأحداث ومنع التكرار. استخدم unitOccupancyAt للمؤشرات إن لزم.
- storage: prototype-workspace-storage.ts + PrototypeContext.tsx + WorkspaceStorageControls/CloudWorkspace/WorkspaceIdentityBoundary وواجهات الاختبارات التابعة. لا تعديل shared/types أو shared/validation/سجل الخصائص. طبّق كذلك resolvePortfolio إذا احتاج السياق واستبعد all من المعرفات. إخطار الفرق عن التغييرات العامة. API القراءة/الكتابة async يجوز بعد تحديث المستهلكين مع الحفاظ على العقد والاختبارات، لا تجاوز auth أو حدود.
- maintenance: OperationsServices.tsx + services/shared.tsx + prototype-maintenance.ts جديد واختباراته. استخدم commitTransition المتاح، لا تعديل Context. يختار العقار/الوحدة بمعرفات ويولد مصروفًا مرتبطًا مرة واحدة عند طلبه لا دفعًا.
- الوكيل الأب: shared/phase1-features.ts، shared/prototype-clock.ts، shared/types/validation، App/navigation/AppFrame/Dashboard/DecisionPages/Route manifest، أداة PDF/رحلة القبول والتقرير/ZIP. لا تعدل هذه الملفات من فرع فريقك.

ساعة السيناريو: shared/prototype-clock.ts يصدر scenarioDate(state أو settings أو ISOstring)، default2026-10-24 معلن؛ validScenarioDate يرفض أيامًا غير صحيحة. أضيف settings.scenarioDate?:string بالمخطط دون تغيير version/حدود. التدقيق يظل زمن العملية الحقيقي. لا تسمّ تاريخ النموذج اليوم بلا توضيح.

القوالب: مستخدم يكتب النص والأربع علامات، DOCXنصي، لا PDFولا Wordمحافظ على التنسيق. اللقطة القديمة لا تعدّل عند تصحيح معرف/تجديد. الجديد لا يرث OLD-123/OLD-DOC/توقيع/تسجيل. التسوية المالية للمدفوع مقدمًا/خسارة/فاتورة قائمة إما صريحة أو رفض حتى المعالجة، بلا محو.
