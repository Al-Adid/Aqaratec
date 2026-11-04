# عقد التنفيذ المشترك

المستخدم طلب بروتوتايب كامل الأفكار F01–F34. جميع الكيانات والعمليات محلية صورية، لا إنتاج ولا ادعاء بنك/واتساب/توقيع/ذكاء موصول. الخطة المعتمدة plan.md وTODO.md والمرجع docs/technical-spec-ar.md. مشروع /home/ubuntu/sunnaafurs. لا تستخدم المتصفح، ولا تثبت تبعيات أو تغير ملفات خارج مسؤوليتك أو تعمل Git.

## نوع البيانات

shared/prototype.ts يصدّر EntityKind وDemoEntity وNewEntity وPrototypeState وBRAND_ASSETS وmoney(numberMinor) وtoMinor(stringQAR) وmetadata(entity,key,fallback). DemoEntity: id,title,subtitle,portfolioId,propertyId,status,date,amountMinor integer cents,currency='QAR',meta:Record<string,string|number|boolean>. المبالغ أعداد صحيحة cents، لا float مالي؛ لا ذكر عملات أخرى كأنها مجموع واحد.

## سياق الواجهة الذي يبنيه الوكيل الرئيسي

استيراد usePrototype من '@/contexts/PrototypeContext'. القيمة:
- state: PrototypeState
- list(kind:EntityKind):DemoEntity[] (كل الكيانات)
- filtered(kind:EntityKind):DemoEntity[] (نطاق المحفظة/العقار إن وجد في الإعدادات؛ المرشح الحالي محفظة لا عقار)
- find(kind,id):DemoEntity|undefined
- add(kind,input:NewEntity):DemoEntity
- patch(kind,id,patch:Partial<DemoEntity>):void
- setStatus(kind,id,status):void
- log(title,detail?):void
- setSetting(key:'role'|'portfolioId'|'period'|'language',value:string):void
- reset():void
- canEdit:boolean (معاينة دور operator فقط، لا إذن خادم)
- recordCollection(receivableId:string,amountMinor:number,method:string,status:string):void
- recordLoss(receivableId:string,amountMinor:number,reason:string):void
- recordRecovery(lossId:string,amountMinor:number):void
- outstanding(receivableId:string):number
- financials: { cashMinor,incomeMinor,expenseMinor,outstandingMinor,lossMinor,recoveryMinor,reserveMinor,depositMinor,freeCashMinor,occupancy:number,propertyCount:number,unitCount:number,expectedMinor:number }

القيمة undefined من find يعرض NotFound الحقيقي بعد تحقق البيانات؛ لا مسار dynamic غير مسجل. النموذج فوري محلي، لا loading API لازم لكل إجراء. الحفظ المحلي تلقائي، وبقية التخزين السحابي optional API يبنيه وكيل مستقل. لا تربط الشاشات الخلفية الافتراضية أو تكتب كما لو كانت بيانات عميل.

## مكونات الواجهة المشتركة

استيراد من '@/components/app/Primitives':
PageHeader({eyebrow?:string,title:string,description?:string,children?:ReactNode})
Panel({title?:string,description?:string,children:ReactNode,action?:ReactNode,className?:string})
Badge({children:ReactNode,tone?:'green'|'amber'|'red'|'blue'|'gray'})
Metric({label:string,value:string,detail?:string,icon?:ReactNode})
EntityTable({rows:DemoEntity[],columns:Array<{key:string,label:string,render?:(row:DemoEntity)=>ReactNode}>,onRow?:(row:DemoEntity)=>void,empty?:string})
FormDialog({title:string,description?:string,trigger:ReactNode,fields:Array<{key:string,label:string,type?:'text'|'number'|'date'|'textarea'|'select',options?:Array<{value:string,label:string}>,required?:boolean,placeholder?:string,defaultValue?:string}>,initialValues?:Record<string,string>,onSubmit:(values:Record<string,string>)=>void,submitLabel?:string})
DemoNotice({mode?:'interactive'|'simulation'|'external',children?:ReactNode})
TabBar({items:Array<{key:string,label:string}>,value:string,onChange:(key:string)=>void})
EmptyState({title:string,description?:string})

الأزرار native button مع className='btn-primary' أو btn-secondary أو btn-ghost؛ الحقول input/select/textarea className='field'. الأغلفة 'stats-grid' 'split-layout' 'section-stack' 'muted' 'mini-label' 'link-button'. اتجاه RTL عالمي. Lucide icons متاحة. الصور BRAND_ASSETS خيالية موسومة داخل البروتوتايب.

## تقاسم الملفات

وكيل Operating: client/src/pages/OperatingPages.tsx ومساعداته داخل client/src/pages/operating/ فقط. صادرات named: PortfoliosPage, PropertiesPage, PropertyDetailPage (prop id:string), LeasesPage, CollectionsPage, FinancePage, ExpensesPage, ReconciliationPage, PaymentsPage, ReportsPage, VacancyPage. Main agent يتولى Dashboard وApp وindex.css وcontext/seed.

وكيل Services: client/src/pages/ServicePages.tsx ومساعداته داخل client/src/pages/services/ فقط. صادرات: DocumentsPage, MaintenancePage, VendorsPage, InspectionsPage, DisputesPage, TasksPage, NotificationsPage, PortalsPage, AssistantPage, MarketingPage, SignaturesPage.

وكيل Decision: client/src/pages/DecisionPages.tsx ومساعداته داخل client/src/pages/decision/ فقط. صادرات: OwnershipPage, MarketPage, GrowthPage, OpportunitiesPage, DataPage, FundingPage, SettingsPage, RoadmapPage. الوكيل يضيف داخل ملفاته تعريف F01–F34 في Roadmap مع المسار المتفق أدناه وتجربة كل خدمة. لا يعدّل ملف shared الذي يستخدمه الآخرون.

وكيل Backend: server/modules/prototype.ts + server/routers.ts (إضافة prototype router فقط) + drizzle/schema.ts (جدول إضافي واحد prototypeWorkspaces)، اختبارات الحفظ والهجرات فقط. لا تعديل الواجهة والمكونات ولا ملفات core auth. يستند إلى API المستخدم الحقيقي ولا ينفذ المالية الإنتاجية.

## المسارات

/ ملخص، /portfolios محافظ، /ownership شركاء، /properties عقارات، /properties/:id ملف، /leases عقود، /collections تحصيل، /finance مالية، /expenses مصروفات، /reconciliation مطابقة، /payments دفع، /reports تقارير، /documents وثائق، /vacancy شغور، /maintenance صيانة ووقاية، /vendors موردون، /inspections معاينات، /disputes نزاعات، /tasks مهام، /notifications تنبيهات، /portals بوابات، /assistant مساعد، /marketing تسويق وطلبات، /signatures توقيع، /market سوق، /growth نمو، /opportunities فرص/مقارنة، /data مصادر/جودة، /funding تمويل، /settings صلاحيات/اشتراكات، /roadmap أفكار34، /404.

## فحوص مهمة

كل إجراء نتيجة مرئية (سجل أو حالة أو معاينة) لا toast وحده. لا تنفيذ خارجي. owner معاينة قراءة وإمكانية موافقة مستقلة موضحة، لا إدخال عامة. المتقدم والمقاول أمثلة علاقة محصورة. المقارنات والخطط والفرص كلها صورية؛ نقص البيانات يظهر امتناعًا. لا upload حقيقي للوثائق أو مدفوعات أو بيانات بطاقات. كل صفحة لديها DemoNotice ذات الحالة المناسبة ومنحنيات/أرقام من النموذج. أنهي مهمة الوكيل بمسارات الملفات وما جرب في check، ووثّق أي حدود بدلاً من الادعاء.
