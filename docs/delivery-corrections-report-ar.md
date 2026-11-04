# صُنّاع الفرص — تقرير الإصلاحات والاختبارات

**نطاق التسليم:** إصلاحات البروتوتايب بناءً على أمر التعديل ذي15 بندًا، مع إضافة قوالب العقود وخيار التأجير الكامل أو الوحدات. لا نشر عام، ولا هجرة SQL، ولا تغيير بيانات فعلية، ولا تفعيل مزود جديد. لم يُغيَّر التصميم العام؛ التعديلات واجهة وظيفية وحراسة أخطاء وتصحيح عناوين ودقة وحفظ.

## الخلاصة التنفيذية

عولجت أخطاء التمويل المتكرر، وصافي الثروة السالب، ومتوسط التشغيل الذي يسقط الأشهر الصفرية، ودرجة فرصة لا تراعي الهدف. أصبح إدخال الحسابات مسودة قابلة للتصحيح بدل كسر الصفحة، وصارت مراجعات الخطط بإصدارات وسجل سبب. أُصلحت قاعدة CAS التي كانت تتبنى revision مرصودًا بدل revision النسخة المحملة، وعزل الحسابات ومساحات التخزين والاسترداد وحدود الحجم. وُصل العقد بالوحدة والاستحقاق بطريقة ذرية، وصُححت الميزانيات وتسميات النقد والاستحقاق وعلامة الإقفال والشغور وسند القبض التاريخي.

**لا يجعل ذلك المنصة إنتاجية:** الحفظ السحابي لقطة خاصة لحساب، والماليات والوثائق بيانات تجربة. القناص محاكاة بيانات أمثلة لا سوق حي. دور الموظف/المالك معاينة واجهة لا صلاحيات مؤسسة مفروضة لكل عملية في الخادم. الإقفال علامة متابعة لا قفل دفتر. خطة الإنتاج منفصلة عن هذه الإصلاحات.

## جدول قبل/بعد للخمسة عشر بندًا

| البند | قبل التعديل | بعد التعديل والأثر | دليل التحقق |
|---|---|---|---|
|01: مصادر التمويل|دخل القرض في تخفيض النقد المطلوب ثم في السعة مرة أخرى.|مصادر واستخدامات متوازنة: منشأة تمويل واحدة تُطبق مرة؛ النقد والقرض المعتمد منفصلان، والتمويل المحتمل مشروط لا يمحو العجز المؤكد.|اختبارات المحرك وسجل RED/GREEN؛ مثالالتمويل المعتمد يطبق مرة واحدة؛ اختبار مصدر/استخدام وعجز نقدي لا تمحوه موافقة محتملة.|
|02: الثروة السالبة|تحول صافي الثروة السالب إلى صفر في أساس الهدف.|الأساس والتوقع موقّعان؛ يبدأ مثال−100 ألف من دين فعلي ولا يخفيه.|اختبار−100 ألف+1000 شهريًا/12 شهرًا يعطي−88 ألف، والفجوة لهدف+10 ألف هي98 ألف.|
|03: تشغيل متكرر|قسمة على الأشهر المتحركة فقط وإسقاط الصفر؛ اعتبار تحصيل عام مستدامًا.|نافذة صريحة شاملة، المتوسط المرصود منفصل عن المستدام، مع استبعاد المتأخر والمجمع والتأمين والاسترداد وغير المربوط وفحص التغطية.|12000 يناير+12000 ديسمبر/12 شهرًا=2000 متوسط مرصود، مع الإفصاح عن10 أشهر صفرية وحدود الاستدامة.|
|04: هدف الفرصة|الهدف عنوان، والدليل قد يرفع فرصة خاسرة.|قواعد اقتصادية خاصة للثروة والدخل والسكن والدين؛ الإخفاق الاقتصادي لا يصبح جيدًا بكثرة الأدلة.|اختبارات خسارة/إيجار0/فائدة دين/أهلية سكن وأسباب الرفض.|
|05: حقول حاسبة القرار|خطأ إدخال قد يرمي استثناءً فيrender.|رسائل عربية قريبة، مسودة لا تضيع، نتائج غير صالحة مخفية أو موسومة بالقدم، ومنع استخدام قديم في قرار جديد.|اختبارات DOM:0+0 مدة،1.5 شهر،قرض أكبر من التكلفة،ضغط101%.|
|06: إصدارات الخطة|نسخة/مراحل قديمة قد تبقى بمعلومات أفق أو ميزانية معدلة.|انتقال ذري لإصدار جديد بمراحل12/60/120 شهرًا وسبب وتاريخ ومراجعة؛ لا مراحل مكررة ولا استبدال إنجاز قديم.|اختبار المساعد واختبار زر الحفظ الفعلي؛ نتائج الدمج النهائية أدناه.|
|07: CAS|BيعيدجلبR2 ثم يحفظ بياناتR1 باستخدامR2 فيطغى علىA.|خط أساس النسخة لا يتغير إلا بتحميل صريح أو نجاح حفظها؛ refetch مرصود فقط. تعارض واضح وتصدير/مقارنة/تحميل أو مساحة محلية منفصلة.|محاكاة عميلينA/B معstoreذاكرة: BيبقىR1 ويرفض بعدA→R2؛ لم يكتب الاختبار في قاعدة فعلية.|
|08: تخزين وهوية|تالف/كبير قد يستبدل بالديمو، ومفتاح محلي غير منسوب لحساب وحدود غير موحدة.|مخطط موحد قبل كل انتقال؛ خام واسترداد وتصدير محفوظان؛ نطاق مستخدم/مساحة، وتبويب آخر لا يُحمّل تلقائيًا؛ quota يبقي الذاكرة؛ تعليق تحقق الهوية لا يسقط النسخة المؤقتة.|اختبارات تالف/>1000 صف/500 للنوع/2000 إجمالي/512KiB/metadata/quota/تبويب/حسابين/خطأ شبكة/تحميل متأخر بهوية مختلفة.|
|09: دورة العقد|التسجيل والتجديد والإنهاء غير متصلين دائمًا بالوحدة والاستحقاق والتاريخ.|مسودة ثم تفعيل صريح، استحقاقات شهرية مرة واحدة بلا قبض، منع تداخل، نفاذ مؤرخ وإصدار تجديد، وحفظ الإيصالات والذمم الماضية. المستقبل الملغى محفوظ لكن لا يحسب ذمة.|اختبارات UTC/نفاذ مستقبلي/إنهاء جزئي/تداخل/تكرار/قالب، واختبار سجل يونيو المرئي في أكتوبر.|
|10: ميزانية/تقارير|إجمالي مصروف يتكرر لكل صف، ورأسمالي0 مفترض، ونقد يسمى استحقاقًا.|مطابقة محفظة/عقار/فئة/بند/فترة، والتداخل الناقص يعرض غير معروف؛ فرق موقّع ووفر/تجاوز؛ نقد واستحقاق ومتبقي منفصلان في الشاشة وCSV.|100 لـAو200 لـBلا300 لكل منهما؛100 ميزانية/130 فعلي=تجاوز30؛1000 استحقاق/400 نقد/600 متبقي.|
|11: إقفال|علامة فترة قد تظهر لمحفظة أخرى، مع لفظ يوحي بقفل.|علامة متابعة مقيدة بالمحفظة والفترة القياسية، معطلة في كل المحافظ ومعلنة أنها لا تمنع التعديل.|مسبار شرط المصدر المجمد، ثم اختبار DOMعزلA/Bوكل المحافظ.|
|12: شغور|عرضallيرفض عقارًا صالحًا؛ الإنهاء قد يعلّم الوحدة مؤجرة بلا عقد.|يرث محفظة العقار ووحدة صحيحة؛ رفض تناقض مع عقد نافذ؛ نهاية الشغور لا تفترض الإشغال.|مسبار الشرط القديم وDOMall، واختبار دورة عقد/شغور ذري.|
|13: Excel|تحقق معاينة مختلف وقد ينشئ بعض الصفوف قبل فشل التالي.|نفس مدقق العقار، تصحيح صفوف ومعاينة وتحقق الدفعة كلها قبلcommit؛ retryلا يكرر. أرقام عربية للحقول العددية ومعرّفات نصية تحفظ الأصفار.|ملفXLSXفعلي صوري في الذاكرة،CSVوفواصل ومعادلات وحجم وتكرار وسنة ونوع خاطئ وصف تالٍ فاشل.|
|14: إيصال تاريخي|أول قبض400 يعرض0 بعد قبض600 لاحقًا بدل600 وقته.|لقطة remainingAfterCollectionMinorوعناصر السند وقت التسجيل؛ القديم بلا لقطة يعرض رصيدًا حاليًا مؤرخًا وشرحًا صريحًا، لا تاريخًا مختلقًا.|فشلREDثم نجاح: سند400 يبقى600 وسند600 يصير0؛ المبالغ السابقة لا تتغير.|
|15: وصف الواقعية|مصدر/تحقق/نواقص وعبارات سحابة غير واضحة بما يكفي.|مصدر وتاريخ وتحقق«غيرمسجل»إن غاب، أسباب ومخاطر ونواقص وملاءمة اقتصادية وتمويلية، وتصريح أن القناص والسحابة والفواتير تجريبية.|فحص الحقول فيDOMومراجعة مصدر مستقلة؛ لا ادعاء مزود حي أو تشغيل إنتاجي.|

## إضافات طلب العقود والعقارات

توجد صفحة **نماذج العقود** من القائمة والداشبورد وسجل العقود. تُرفع TXT/DOCX محليًا أو يُلصق النص، وتُوضع أربع علامات: `{{الاسم}}`،`{{رقم_العقار}}`،`{{رقم_الكهرباء}}`،`{{نوع_العقار}}`. يُحفظ كل إصدار مستقلًا، وتُولد مسودة ببيانات عقار أو وحدة صحيحة ومعاينة وطباعة؛ لا تُفعّل عقدًا أو تسجيلًا أو تحصيلًا. اختيار الوحدة سياق لازم عند العقار المقسم، لا متغير نصي خامس مطلوب في القالب. Wordيُستورد نصًا لا نسخة مطابقة لتنسيقه، وPDFلا يُستورد من هذه الشاشة.

في إضافة العقار توجد **تأجير كامل** بهدف تأجير داخلي واحد، أو **تقسيم إلى وحدات** من2 إلى50، مع أرقام العقار والكهرباء محفوظة نصًا. التقسيم في النظام ليس تصريحًا قانونيًا أو تغيير استعمال. أرقام العدادات للوحدات يمكن حفظها وربطها بالقالب؛ لا يخمّن النظام رقمًا رسميًا عند الغياب.

## نتائج التنفيذ وحدود التحقق

- `pnpm check`: ناجح؛ فحص TypeScript بدون إصدار ملفات.
- `pnpm test`: **220 اختبارًا ناجحًا في 47 ملفًا**، ولا اختبار فاشل أو متروك في نتيجة التشغيل النهائية.
- `pnpm build`: ناجح للواجهة والخادم. بقي تحذير حجم الحزم الأمامية (>500kB)، وهو قيد أداء يحتاج تحسين تحميل/تقسيم لاحقًا وليس فشل بناء.
- فحص المسارات وHTTP health ناجح؛ أدلة التنفيذ موجودة في `docs/qa-evidence`.
- فشل اختبار الهدف الوسيط كشف عيبًا فعليًا: تحديث سجل التدقيق أعاد هيدرة الملف ومسح هدف المسودة قبل حفظه. أُصلح نطاق الهيدرة، وأثبت الاختبار نسخة جديدة مع بقاء الهدف القديم؛ لم نغيّر التوقع فقط لتنجح الاختبارات.

فحص المقاسات:375 و390 و768 و1440 بكسل بلقطات فعلية من معاينة المشروع، مع RTLوعدد العقارات والتحصيل والقوالب والفواتير والعقود والمستشار والقناص والتقارير. كشفت صورة768 صفرعقود في أكتوبر رغم عقود أقدم؛ أصلح مرشح مخزون العقود وأضاف اختبارًا ضيقًا. اختبارات DOM تفحص فتح/إغلاق/Escape ورجوع التركيز والطباعة ببديل window.print. Tab اختُبر في المتصفح المُدار للتنقل، لكن حوار الإضافة بقي محميًا بسبب نسخة محلية قديمة ولم نصلحها لتجاوز الحراسة. أضيف إشعار الاسترداد في كل صفحة بدل إخفاء سبب الحظر داخل زر السحابة. لا تعد هذه الاختبارات دراسة مستخدمين أو اختبار VoiceOver/Safari فعليًا.

**قبولPDF/A4 جزئي:** توجد قواعد طباعةA4 عربية ومعاينة صورية وزر طباعة متصفح واختبار استدعائه، لكن لم يُنتج ملفPDFفعلي من نافذة الطباعة ولم تُفحص حدوده بصريًا. لذلك لا يُدعى أنه غير مقصوص أو جاهز محاسبيًا. اختبار إلزامي باقٍ قبل اعتماد وثائق طويلة/متعددة الصفحات علىSafariوالطابعات الفعلية.

التزامن والحسابان اختُبرا بمحاكاة جلسات وstoreذاكرة وأحداث تخزين، لا بجهازين أو حسابين إنتاجيين حيّين. لم يُشغل مزود دفع أو بنك أو سوق أو توقيع أو مهمة يومية. مؤشرات الدورية والاستدامة تحفظية، ولا تتنبأ بالسوق.

## قائمة الملفات المتغيرة

- `TODO.md`
- `client/public/manus-routes.json`
- `client/src/App.tsx`
- `client/src/components/app/AppFrame.tsx`
- `client/src/components/app/BillingDocumentPreview.tsx`
- `client/src/components/app/CloudWorkspace.tsx`
- `client/src/components/app/LeaseDocumentPreview.css`
- `client/src/components/app/LeaseDocumentPreview.tsx`
- `client/src/components/app/PropertyImport.tsx`
- `client/src/components/app/WorkspaceIdentityBoundary.test.tsx`
- `client/src/components/app/WorkspaceIdentityBoundary.tsx`
- `client/src/components/app/WorkspaceStorageBanner.test.tsx`
- `client/src/components/app/WorkspaceStorageBanner.tsx`
- `client/src/components/app/WorkspaceStorageControls.tsx`
- `client/src/contexts/PrototypeContext.storage.test.tsx`
- `client/src/contexts/PrototypeContext.tsx`
- `client/src/index.css`
- `client/src/lib/advisor-plan-versions.spec.ts`
- `client/src/lib/advisor-plan-versions.ts`
- `client/src/lib/billing-receipt-history.spec.ts`
- `client/src/lib/lease-cancelled-finance.spec.ts`
- `client/src/lib/lease-template-engine.spec.ts`
- `client/src/lib/lease-template-engine.ts`
- `client/src/lib/navigation.ts`
- `client/src/lib/property-arabic-numbers.spec.ts`
- `client/src/lib/property-fields.spec.ts`
- `client/src/lib/property-fields.ts`
- `client/src/lib/property-import-ui.test.tsx`
- `client/src/lib/property-import.spec.ts`
- `client/src/lib/property-import.ts`
- `client/src/lib/prototype-billing.ts`
- `client/src/lib/prototype-budget.spec.ts`
- `client/src/lib/prototype-budget.ts`
- `client/src/lib/prototype-finance.ts`
- `client/src/lib/prototype-lease-lifecycle.spec.ts`
- `client/src/lib/prototype-lease-lifecycle.ts`
- `client/src/lib/prototype-monthly-ui.test.tsx`
- `client/src/lib/prototype-payments.ts`
- `client/src/lib/prototype-rental.spec.ts`
- `client/src/lib/prototype-rental.ts`
- `client/src/lib/prototype-workspace-storage.spec.ts`
- `client/src/lib/prototype-workspace-storage.ts`
- `client/src/lib/template-file-docx.spec.ts`
- `client/src/lib/template-file-import.spec.ts`
- `client/src/lib/template-file-import.ts`
- `client/src/pages/Dashboard.tsx`
- `client/src/pages/advisory/OpportunityHunterPage.tsx`
- `client/src/pages/advisory/RealEstateAdvisorPage.tsx`
- `client/src/pages/advisory/advisor-integration.test.tsx`
- `client/src/pages/advisory/advisor-ui-regression.test.tsx`
- `client/src/pages/advisory/advisor.css`
- `client/src/pages/billing/BillingPage.test.tsx`
- `client/src/pages/contracts/ContractTemplatesPage.test.tsx`
- `client/src/pages/contracts/ContractTemplatesPage.tsx`
- `client/src/pages/contracts/contracts.css`
- `client/src/pages/operating/FinancePages.tsx`
- `client/src/pages/operating/LeaseCollectionPages.tsx`
- `client/src/pages/operating/LeaseStock.test.tsx`
- `client/src/pages/operating/PortfolioPropertyPages.tsx`
- `client/src/pages/operating/ReportsVacancyPages.budget.test.tsx`
- `client/src/pages/operating/ReportsVacancyPages.tsx`
- `client/src/pages/operating/operatingUtils.tsx`
- `client/src/pages/operating/property-sheet.css`
- `client/src/pages/services/DocumentServices.tsx`
- `docs/advisor-calculation-corrections.md`
- `docs/advisor-ui-corrections.md`
- `docs/correction-integration-review.md`
- `docs/correction-order-ar.md`
- `docs/delivery-corrections-report-ar.md`
- `docs/lease-corrections.md`
- `docs/production-transition-plan-ar.md`
- `docs/receipt-history-corrections.md`
- `docs/reports-corrections.md`
- `docs/responsive-and-print-validation.md`
- `docs/source-export-guide-ar.md`
- `docs/storage-corrections.md`
- `package.json`
- `plan.md`
- `pnpm-lock.yaml`
- `server/modules/prototype-load-identity.spec.ts`
- `server/modules/prototype.spec.ts`
- `server/modules/prototype.ts`
- `shared/advisor-corrections.spec.ts`
- `shared/advisor-engine.spec.ts`
- `shared/advisor-engine.ts`
- `shared/advisor-types.ts`
- `shared/billing-types.ts`
- `shared/lease-template-types.ts`
- `shared/mammoth-browser.d.ts`
- `shared/prototype-validation.spec.ts`
- `shared/prototype-validation.ts`

## تشغيل المراجعة وحفظها

`pnpm check`للأنواع،`pnpm test`للاختبارات،`pnpm build`للبناء. الأدلة الأساسية قبل/بعد ضمن حزمةالمصدر في`docs`و`docs/qa-evidence`؛ خط الأساس مجمد قبل التنفيذ ولم يعاد كتابته. الاختبارات غير المالكة للحساب لا تكتب في قاعدةManusالمشتركة. الأرشيف كود مصدر لا تطبيق يفتح بتشغيلZIPعلى الآيفون، ولا يشملأسرارًا أو بيانات متصفحك أو نسخةقاعدةبيانات.

الرابط العام يبقى كما كان. أي نشر أو ترحيل أو إدخال بيانات فعلية أو تفعيل موصلات يحتاج خطوة منفصلة ومعتمدة.
