# توسعة التسويق26أكتوبر2026

المشروع /home/ubuntu/sunnaafurs. المستخدم يريد قسمًا للعقارات غير المؤجرة والقريبة من انتهاء العقود، موجزًا لشركات الوساطة وسجل شركات شامل. الواجهة الحالية /marketing قائمة شاغر ومعاينة فقط. البريدsuhaim@qissatec.comمثال غير موصول، وسؤال خدمة البريد معلّق؛ لا إرسال شبكي في هذه الجولة دون جواب وتفويض.

## ملكية الملفات

فريق المحرك يملك client/src/lib/broker-marketing.ts وbroker-marketing.spec.ts، وله ملفات broker-marketing-extension.spec.ts إضافية. فريق الواجهة يملك pages/marketing/BrokerMarketingPage.tsx وbroker-marketing.css واختباراتهما فقط. المنسّق يملك lib/broker-email-drafts.tsواختباره، plan/TODOوالتنقلوفهرسالخدمات وربطالسياق إن لزم. لا تغييرات SQLأو قواعد بيانات أو أصول صور أو مصادقة أو محركات مالية. commitTransition يطبق انتقالًا ذريًا على أحدث PrototypeState.

## API متفق عليه للمحرك

- listBrokerTargets(state, options?:{expiringWithinDays?:number;includeExpiring?:boolean}):BrokerTarget[]. بدونoptionsينبغي أن يبقى compatibleبالشاغر فقط. includeExpiring=true معexpiringWithinDays60يعرض الشاغر والقريب. خيارات30/60/90، والتحقق عند اختيارغيرصالح.
- BrokerTargetيبقى id=unit.id وإضافة availability:'vacant'|'expiring', contractEndDate?:string, availableFrom:string, daysToExpiry?:number, propertyType:string, location:string, area?:number إلى حقوله القديمة. upcomingعقدنافذفعليًا فقط؛ انتهاءاليوميعرض expiringودرجة0؛ availabilityمناليومالتالي. عقدتجديدنافذيمنعموعدًاكاذبًا، وهندسةالتواريخلهاساعةسيناريو؛ لا تنشأذممنالحملة. legacypropertyغيرمحددrentalModeلايفترضكاملًا. السعر يبدأ0ويحتاجإدخالًاصريحًا.
- BrokerContactInputضيفphone?:string,website?:string,address?:string,notes?:string,active?:booleanاختيارية ضمنحدودmeta. createBrokerContactكماهو متوافق؛ updateBrokerContact(state,{...BrokerContactInput,brokerId:string}):Transition<DemoEntity> معحراسةالعلاقةوالتكراروأصلالمعرفوidempotency؛ الحالةبـmeta.active (غيابالحقلنشطلتوافقالسابق)، subtitleمسؤول. حالةالإيقافلاغيهااختيارالمستلمينلاالأرشيف.
- BrokerCampaignInputيبقىكماهوويضيف expiringWithinDays?:number (غيابهشاغرفقط كماالسابق). saveBrokerCampaignيحفظ لقطةBriefمؤرخة (لا بيانات مستأجرين) إضافةللحقولالقديمةوtargetsJSONمعآخرإعادةتحقق. تقسمالسلاسل>1024بـchunksضمن32مفتاحًا؛ حدكلي512KiBباق.
- getBrokerCampaignBrief(state,campaign):{subject:string;body:string;targets:BrokerTargetBrief[];recipients:BrokerRecipientBrief[];asOf:string}. typesللـtargets: targetId,propertyId,propertyTitle,propertyNumber,unitTitle,unitCode,propertyType,location,area?,monthlyRentMinor,availability,contractEndDate?,availableFrom. recipients:brokerId,companyName,contactName,email,phone?. frozenعندالحفظولوعدل أوأوقفالوسيطلاحقًا؛ القديميعرضlegacyمعراجعحاليوتنبيهصريحلايختلقsnapshotقديم. هذهtypeexportsلازم الفريقان يستخدمونها.
- simulateBrokerCampaignDispatch(state,{campaignId:string,requestId:string}):Transition<DemoEntity>. يسجلوثيقةتحربةمحليةغيرمرسلةلكلجهة أولقطةsummary معrecipientJSON/chunks وحالةsimulated-not-sentلاsmtp/To/network. لا تعتبرالقائمةالمجمدةإذنًالخادم، تعيدفحصأهليةالوسطاءوالأهدافوالقيمةوقتالمحاكاةوتضمنnot-editcurrentdata. منعطلبمتكرروشركةموقوفةوحملة منمحفظةخارجالنطاق.

## UI

تحت عنوان «التسويق العقاري» قائمة شركات وساطة كاملة وأهداف اختيار مع toggleشاغرة/قريبة/الكل ونافذة30/60/90. طاولةمألوفةوأرقامنوعوموقعوتاريختوافر، موجزعربييمكنتعديلوصف600حرفوصراحةنسخةالتجربة. الحفظ/المحاكاةأزرارغيرملتبسةمنالنشر. لا طلببياناتهويةأومعلوماتمستأجرفيالموجز.

المنسقيقدّم `downloadBrokerBrief(brief)` و`downloadBrokerEmailDraft(brief,recipient)` من@/lib/broker-email-drafts.ts. تعودvoidتنزيلBlobمحليلـtxtوeml؛ المتصفحلايرسلشيئًا، `.eml`ToلشركةواحدةليسقائمةBCCتكشفالوسطاء. يصرحالتصميمأنالإرسالالحيبإعدادمعلّق. لا داعيلمكتباتجديدة. التغييراتتحفظالبياناتالقديمةولاترميالمرفقاتالمحليةأوخسائرالتحصيل أوالعقود.
