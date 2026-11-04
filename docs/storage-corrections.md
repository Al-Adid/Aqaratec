# تصحيحات التخزين ولقطة السحابة — R07 / R08 / R15

## النطاق الصريح

هذا الإصلاح خاص ببروتوتايب ببيانات خيالية. لم يُنشر رابط عام، ولم تُنفذ هجرة SQL أو كتابة قاعدة بيانات أثناء العمل أو أي مزود خارجي أو بيانات حقيقية. يبقى تخزين السحابة لقطة محمية لكل مستخدم موجود أصلًا؛ لا يحوله هذا الإصلاح إلى دفتر محاسبي أو مساحة عمل سحابية متعددة المستخدمين.

## ما أُعيد إنتاجه قبل الإصلاح

سُجلت إعادة إنتاج خط الأساس في:

- `/home/ubuntu/reports/correction-audit/storage-red.log`

يثبت مسبار R07 القديم أن الجهاز B الذي بنى نسخته على R1 كان يتبنى رقم R2 بعد refetch ثم يرسل نسخته القديمة مع `expectedRevision=2`؛ قبلها الخادم وكتب R3 فوق لقطة A. سجل R08 أيضًا أن تحقق الخادم كان يرفض 501 صفًا/نوعًا و2,001 إجمالًا واللقطة الأكبر من 512 KiB، بينما العميل لم يكن يوحد تلك الحدود أو يحفظ أصل التخزين التالف.

## العقد الموحد والحدود

`shared/prototype-validation.ts` هو المصدر الوحيد لمخطط Zod المستخدم في العميل والخادم. قياس JSON يستخدم `TextEncoder`، ولذلك هو آمن للمتصفح ولا يعتمد على `Buffer` الخاص بـ Node.

| الحد | القيمة |
|---|---:|
| الصفوف لكل نوع | 500 |
| إجمالي صفوف الكيانات | 2,000 |
| حجم جسم JSON UTF-8 | 512 KiB |
| سجل التدقيق | 500 |
| مفاتيح `meta` | 32 |
| نص `meta` | 1,024 حرفًا |
| قيمة `meta` الرقمية | ±1,000,000,000,000 |
| المبلغ | عدد صحيح آمن غير سالب |

يستدعي `PrototypeContext` التحقق الكامل قبل تغيير `stateRef` أو React state في كل انتقال، ومنها الإضافة والتعديل والاستيراد والدوال المالية والقوالب والعقار و`commitTransition<T>`. وبذلك لا يصدر حدث حالة جزئي عندما يفشل التحقق.

## التخزين المحلي والاسترداد

`client/src/lib/prototype-workspace-storage.ts` يخزن جسم `PrototypeState` الخام فقط، بلا envelope، في مفتاح نطاقه:

```text
sunnaa-full-prototype-v2:user:<authenticated-user-or-guest>:workspace:<local-workspace>
```

تخزن metadata منفصلة للمفتاح نفسه (`:metadata`) وتحتوي generation محليًا و`cloudBaseRevision`. تحفظ نسخة الاسترداد الأولى في `:recovery` ولا تستبدل الأصل التالف؛ تحفظ النسخة المحلية قبل تحميل صريح في `:backup`.

- JSON التالف أو لقطة غير مطابقة أو أكبر من الحد لا تفتح بيانات الديمو باعتبارها بديلًا ولا تكتب فوق النص الخام عند mount.
- تظهر `WorkspaceStorageControls` تصدير الحالة الموجودة في الذاكرة وتصدير النص الخام، وإصلاحًا صريحًا بعد الاحتفاظ بالاسترداد، ومساحة محلية منفصلة.
- فشل quota/التخزين يبقي الحالة في الذاكرة قابلة للتصدير مع تحذير صريح، ولا يتخلص من التغييرات.
- المفتاح القديم غير المقسم `sunnaa-full-prototype-v1` لا ينسب تلقائيًا إلى حساب مسجل ولا يكتب فوقه. يظهر تحذير خصوصية مع تصدير أو إصلاح صريح فقط.
- `storage` event و`BroadcastChannel` يوقفان الكتابة عند تعديل تبويب آخر؛ لا يوجد تحميل أو overwrite تلقائي. كل كتابة تتطلب generation المحلي المتوقع.

## الهوية والحدود السحابية

يوفر `WorkspaceIdentityBoundary` استعلام `auth.me` مفعّلًا دائمًا. أثناء `pending` يركب `PrototypeProvider` بحالة صورية مؤقتة للقراءة، من دون قراءة namespace شخصي أو السماح بالحفظ السحابي. عند اكتمال الهوية يعاد تركيب provider مع مفتاح المستخدم الصحيح، فلا يمكن لاستجابة قديمة ترقية بيانات حساب آخر.

إذا فشل استعلام الهوية، تبقى الحالة `pending` ومقفلة مع رسالة تحقق آمنة؛ لا تتحول إلى guest ولا تقرأ أي مساحة محفوظة قد تخص حسابًا سابقًا. الحالة guest العادية لا تبدأ إلا بعد جواب غير موثّق ناجح بلا خطأ.

يبقى `PrototypeProvider` المباشر مناسبًا للـSSR والاختبارات: افتراضيًا هو guest معروف ضمن مساحة `guest/default` المقسمة، وليس pending.

تخزن `cloudBaseRevision` مع الحالة المحلية المقسمة. لا تغيرها `CloudWorkspace` عند refetch؛ الرقم البعيد في هذه الحالة **مرصود** فقط. تتغير فقط في الحالات الآتية:

1. ملاحظة صريحة أن السحابة فارغة فعلًا عند R0؛
2. تحميل صريح للقطة السحابية بعد التأكيد وإنشاء backup محلي؛
3. نجاح حفظ اللقطة المحلية نفسها، مع بقاء scope وbody المحليين مطابقين للطلب.

لذلك في تسلسل R1 (A وB) ثم A→R2 ثم B refetch، يبقى خط أساس B=R1؛ حفظ B يطلب R1 ويستلم `CONFLICT` بدل الكتابة فوق R2. يحتفظ UI بحالة B ويعرض التصدير/المقارنة/التحميل الصريح/مساحة محلية منفصلة. الخادم ما زال يستخدم CAS الذري نفسه، مع حارس `clientUserId` الضيق الذي يرفض طلب مكوّن متأخر إذا لم يطابق `ctx.user.id` الحالي؛ لا يمنح هذا صلاحيات جديدة.

نص cloud footnote يصرح الآن أن الحفظ لقطة بروتوتايب صورية خاصة، وليس نظامًا محاسبيًا أو دفترًا متعدد المستخدمين أو خدمة إنتاجية.

## واجهة App التي يركبها مالكها

لا تعدل هذه المهمة `client/src/App.tsx`. يستبدل مالك App الاستيراد والالتفاف فقط كما يلي:

```tsx
import { WorkspaceIdentityBoundary } from "./components/app/WorkspaceIdentityBoundary";

// استبدل <PrototypeProvider> ... </PrototypeProvider> بـ:
<WorkspaceIdentityBoundary>
  <Toaster position="top-center" richColors />
  <AppFrame>
    <Router />
  </AppFrame>
</WorkspaceIdentityBoundary>
```

يبقى `ThemeProvider` و`TooltipProvider` و`ErrorBoundary` كما هي. لا يمرر App أي prop. API المصدر متاح من `@/contexts/PrototypeContext`:

- `PrototypeProvider` مع `identity?: PrototypeWorkspaceIdentity`؛
- `usePrototype().identity`, `.storage`, `.cloudBaseline`؛
- عمليات `.exportWorkspace()`, `.exportRecoveryRaw()`, `.repairLocalWorkspace()`, `.loadLatestLocalWorkspace()`, `.createSeparateLocalWorkspace()`؛
- عمليات cloud الصريحة `.adoptCloudWorkspace()`, `.initializeEmptyCloudBaseline()`, `.markCloudSaveSuccess()`.

## تعديل fixtures الموجودة خارج نطاق هذا التعديل

الاختبارات الثلاثة التي كانت تقرأ المفتاح القديم مباشرة يجب أن تستورد `prototypeWorkspaceStorageKey` من `@/lib/prototype-workspace-storage` وتقرأ `prototypeWorkspaceStorageKey()` (guest/default) بدل النص `sunnaa-full-prototype-v1`:

- `client/src/lib/prototype-monthly-ui.test.tsx`
- `client/src/lib/property-import-ui.test.tsx`
- `client/src/pages/billing/BillingPage.test.tsx`

لا تحتاج تلك assertions إلى قراءة metadata؛ جسم الحالة تحت المفتاح الجديد ما زال JSON `PrototypeState` نفسه، لذلك تبقى assertions المال كما هي.

## نتائج التحقق الفعلية

نفذت بعد الإصلاح:

```text
pnpm vitest run shared/prototype-validation.spec.ts \
  client/src/lib/prototype-workspace-storage.spec.ts \
  client/src/contexts/PrototypeContext.storage.test.tsx \
  server/modules/prototype.spec.ts

Test Files  4 passed (4)
Tests       22 passed (22)

pnpm check
# tsc --noEmit: passed
```

تشمل الاختبارات الجديدة: JSON تالف، raw أكبر من 1,000 صف لا يتغير، حدود 500/2,000، metadata، حد byte UTF-8، quota مع بقاء الحالة قابلة للتصدير، generation لتبويبين، حسابين ومساحتي عمل، legacy غير المنسوب، `storage` event، تبني R1/R2 الصريح، وخط سير CAS لجهاز B الذي يعيد الجلب ثم يتعارض بدل overwrite.

لم يُشغّل في هذا النطاق `pnpm test` الكامل أو `pnpm build` أثناء دمج أعمال فرق أخرى بالتوازي؛ يلزم تشغيلهما من مالك الدمج بعد تحديث App وfixtures أعلاه. لا تدعي هذه الاختبارات تواصلًا حيًا مع قاعدة بيانات أو جلسة مستخدم حقيقية أو خدمة خارجية.

## فحص دمج إضافي للهوية

أضاف مالك الدمج حارسclientUserIdلاستعلامloadمثلsave، واختبارًا يرفض الطلب11عندما تكون جلسة الخادم22قبل قراءةstore. احتفظWorkspaceIdentityBoundaryبمزودالحسابالمتحققأثناءإعادةفحصخلفيةمعحظرالتعديل/السحابة،بدلإعادةتركيبهواختفاءتغييراتquotaالموجودةفيالذاكرة. تحققابتدائيغيرمعروفلايزاليستخدمpendingولايتصفحnamespaceشخصيًا. اختبرWorkspaceIdentityBoundary.test.tsxخطأالشبكةثمعودةAوتبديلهإلىB؛ لم تظهرعلامةAالمؤقتةلـB. الاختباران الإضافيان ناجحان2/2فيالذاكرةفقط.
