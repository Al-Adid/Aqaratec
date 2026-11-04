# B01 — لقطة قالب مستقلة للتجديد

**التاريخ:** 25 أكتوبر 2026  
**النطاق المنفذ:** مسودة تجديد عقد قائمة فقط، ببيانات خيالية محلية. لا يتضمن هذا التغيير مزود دفع أو توقيعًا قانونيًا أو تسجيلًا حكوميًا أو قاعدة بيانات أو نشرًا.

## النتيجة

عالج التنفيذ مانع B01: لا يمكن الآن تفعيل عقد يحمل دلالة قالب (`templateId`) أو وسم طلب لقطة تجديد (`newTemplateSnapshotRequired`) ما لم يملك **وثيقة لقطة فعلية ومكتملة** تخص العقد نفسه وتطابق `templateId` و`templateVersion` الحاليين. لا تكفي علامة metadata ولا `snapshotDocumentId` يعود لعقد سابق.

أضيفت الدالة التالية إلى `client/src/lib/lease-template-engine.ts`:

```ts
refreshRenewalTemplateSnapshot(
  state: PrototypeState,
  leaseId: string,
  templateId: string,
  requestId: string
): { state: PrototypeState; result: DemoEntity }
```

تعمل الدالة على مسودة تجديد قائمة (`priorLeaseId`) فقط، وبصلاحية معاينة الموظف ونطاق المحفظة. تختار قالبًا مشتركًا أو تابعًا لمحفظة العقار، وتتحقق من النسخة/الأجزاء المخزنة للقالب قبل الإنشاء. تقرأ البيانات الموثوقة من مسودة التجديد والعقار الحالي:

- المستأجر من المسودة الحالية؛
- رقم العقار ونوعه من بيانات العقار الحالية؛
- رقم الكهرباء من `electricityNumberForRentalTarget`، فلا يعاد استعمال رقم لقطة قديمة؛
- الإيجار وتاريخ البداية والنهاية من شروط التجديد الحالية.

يشترط التنفيذ أن تطابق قيمة الإيجار ومدة القالب المحدد شروط التجديد. عند عدم المطابقة يعيد الخطأ الصريح: «القالب المختار لا يطابق إيجار أو مدة التجديد الحالية؛ عدّل نموذج التجديد مرة واحدة ثم أنشئ لقطة جديدة». لا تحدث أي كتابة قبل اكتمال هذه التحققات.

عند النجاح ينشئ Document instance جديدًا وأجزاءه فقط، وكل جزء يشير إلى وثيقة التجديد الجديدة، والوثيقة تشير إلى `leaseId` الخاص بالتجديد. تحدث المسودة إلى `templateId` و`templateVersion` و`snapshotDocumentId` الجديدين، وتزيل وسم الطلب. لا تعدل وثيقة العقد السابق أو أجزاءها أو شروطها أو إثبات التسجيل/التوقيع فيه. إعادة نفس `requestId` المطابق تعيد نفس الوثيقة والحالة بلا Document أو AR إضافي؛ استعماله لطلب مختلف يرفض.

## حاجز التفعيل

في `activateLease` أضيف فحص قبل إنشاء الاستحقاقات. عند وجود `newTemplateSnapshotRequired` أو `templateId` يفحص:

1. وجود `templateId` و`templateVersion` و`snapshotDocumentId` صالحين على المسودة؛
2. وجود الوثيقة وتكامل الأجزاء المخزنة؛
3. أن `document.meta.leaseId === lease.id`؛
4. أن `document.meta.templateId` وإصدارها يطابقان النسخة الحالية في المسودة.

أي وثيقة سابقة أو ناقصة أو بإصدار مختلف ترفض التفعيل قبل تغيير الحالة أو إنشاء أي ذمة. بعد لقطة صحيحة يبقى التفعيل نفسه كما كان: ينشئ الاستحقاقات مرة واحدة ولا ينشئ قبضًا أو حركة نقدية أو وثيقة إضافية.

## الواجهة

أضيف في صف مسودة التجديد زر **«توليد وثيقة التجديد»**. يعرض `FormDialog` لاختيار آخر إصدار متاح من القوالب المشتركة أو قوالب محفظة العقد فقط. يستدعي الزر واجهة Context التالية التي يضيفها الوكيل الأب:

```ts
refreshRenewalTemplateSnapshot(leaseId, templateId, requestId): boolean
```

القيمة `true` تعني إنشاء اللقطة، و`false` تعني retry مطابقًا لم ينشئ شيئًا جديدًا. نص الواجهة يوضح أن توليد الوثيقة لا يفعّل العقد ولا ينشئ ذممًا أو قبضًا، وأن التسجيل والتوقيع يظلان غير متحققين.

## اختبار regression المضاف

الملف: `client/src/lib/renewal-template-snapshot.spec.ts`

السيناريو الأول يثبت بالذاكرة فقط:

1. عقد أصلي من قالب مع وثيقة ثابتة صراحة باسم `OLD-DOC` ومحتوى يحوي `OLD-METER` وإثباتات `OLD-123`/`OLD-SIGNATURE`.
2. تجديد مبكر من 1 يوليو 2026 إلى 30 يونيو 2027 بإيجار 1200 ر.ق.
3. فشل `activateLease` بلا لقطة جديدة، مع بقاء عدد الوثائق وذمم التجديد صفرًا.
4. تصحيح رقم الكهرباء الحالي إلى `00999` ثم توليد لقطة تجديد مستقلة من قالب يطابق 1200/12 شهرًا.
5. إثبات أن الوثيقة الجديدة تخص التجديد وتحمل الإيجار والبداية والنهاية والقالب/الإصدار ورقم الكهرباء الحالي، مع جزء واحد مرتبط بها.
6. إثبات بقاء `OLD-DOC` ومحتواه وإثباتاته بلا تغيير.
7. إثبات أن retry توليد اللقطة لا ينشئ وثيقة ثانية، وأن التفعيل بعدها ينشئ 12 ذمة مرة واحدة فقط ولا ينشئ قبضًا، وأن retry التفعيل لا يضيف ذممًا.

السيناريو الثاني يثبت أن قالب 1000 ر.ق. لا يصلح لمسودة تجديد 1200 ر.ق. وأن الرفض لا يغير الحالة أو الوثائق.

### سجل التنفيذ

```text
pnpm vitest run client/src/lib/renewal-template-snapshot.spec.ts
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    566ms
```

تم أيضًا تشغيل أقرب اختبارات قائمة:

```text
pnpm vitest run client/src/lib/lease-template-engine.spec.ts client/src/lib/prototype-lease-lifecycle.spec.ts
lease-template-engine.spec.ts: 6 passed
prototype-lease-lifecycle.spec.ts: 16 passed, 1 failed
```

الفشل الوحيد في الاختبار القديم `prototype-lease-lifecycle.spec.ts` ليس فشلًا في الانتقال الجديد: يبني يدويًا عقدًا باسم `template-draft` يضع `templateId: "template-1"` بلا `templateVersion` أو `snapshotDocumentId` أو Document/chunks. هذا fixture أصبح مخالفًا لشرط B01 الذي يفرضه الاختبار الجديد. لا يُخفى الفشل بتخفيف الحاجز؛ يجب على مالك الاختبار إما إزالة دلالة القالب إن كان المقصود اختبار عقد يدوي عادي، أو إنشاء لقطة قالب صحيحة مطابقة له إن كان المقصود اختبار عقد مولد من قالب.

## تعديل مطلوب من الوكيل الأب في `phase1-journey.spec.ts` — لا يعدل هذا الملف هنا

الرحلة الحالية تجدد عقدًا بإيجار 1200 ر.ق. لكنها تحتفظ بالقالب v1 ذي الإيجار الافتراضي 1000 ر.ق. ثم تستدعي `activateLease(renewed.state, ...)` وتتوقع غياب `snapshotDocumentId`. هذا يناقض شرط B01 وشروط مطابقة القالب الجديدة.

التعديل الدقيق المطلوب:

1. استورد `refreshRenewalTemplateSnapshot` من `lease-template-engine`.
2. بعد `withOriginalProof` وقبل `renewLease`، احفظ **إصدار قالب جديدًا مستقلًا** مصدره `template.template.id` بقيمة `defaultRentMinor: QAR_1200` و`defaultTermMonths: 12` (مع نفس الرموز/المحتوى أو محتوى إصدار جديد صحيح). استخدم `renewalTemplate.state` كحالة الإدخال إلى `renewLease`، لا تعدل v1.
3. بعد `renewed` وretry الخاص به، استدعِ:

   ```ts
   const renewedSnapshot = refreshRenewalTemplateSnapshot(
     renewed.state,
     renewed.result.id,
     renewalTemplate.template.id,
     "p05-early-renewal-snapshot"
   );
   const activeRenewal = activateLease(
     renewedSnapshot.state,
     renewed.result.id,
     SCENARIO_DATE
   );
   ```

4. عدّل ناتج الرحلة/توقعاتها ليقرأ عقد التجديد من `renewedSnapshot.state` أو الحالة اللاحقة، وليتوقع `snapshotDocumentId` موجودًا ومختلفًا عن وثيقة العقد الأصلي، و`templateId/templateVersion` للإصدار الجديد، وزوال `newTemplateSnapshotRequired`. لا تبقِ التوقع `snapshotDocumentId` غير معرّف.
5. أبقِ تأكيدات ثبات الوثيقة الأصلية ومحتواها `00129` كما هي؛ أضف فحصًا أن وثيقة التجديد الجديدة تخص `renewed.result.id` ولا يعاد استعمال `originalSnapshot.document.id`.

## حدود التحقق

شُغّل regression المخصص ووحدات القالب القريبة فقط. لم يُشغّل `check` أو المجموعة كاملة أو build أو متصفح أو طباعة أو تخزين أو قاعدة بيانات أو Git أو نشر. لم تتغير منطق الإيجار أو الذمم التاريخية أو التحصيل أو التوقيع أو التسجيل خارج حاجز منع التفعيل قبل اللقطة.
