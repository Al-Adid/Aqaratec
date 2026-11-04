# عقد تنفيذ بيانات الوحدات والصور

المشروع /home/ubuntu/sunnaafurs. TypeScriptReactExpress. المستخدم يريد بيع/إيجار،حر/مرهون،صور العقار،رقم تسلسلي الوحدة،مخطط/ماء/كهرباء الوحدة،صور فردية ومجموعة لوحدات مختارة،فيلا متلاصقة/منفصلة،شقة استوديو أو عدد غرف وصالة ومفروشة/غيرمفروشة. يبقى حفظ البروتوتايب المحلي والنسخ القديمة والمالية كما هي.

## فريق البيانات

يمتلك property-fields.ts وprototype-rental.ts وملفunit-profile.tsالجديد واختباراتها فقط. العقود المشتركة shared/unit-profile-types.ts. واجهة الدوال المطلوبة منclient/src/lib/unit-profile.ts:

- parsePropertyProfile(value:unknown):PropertyProfile؛serializePropertyProfile(value:PropertyProfile):string؛propertyPurposeLabel(value:unknown):string؛mortgageStatusLabel(value:unknown):string. labelيقبل enumمباشرًا.
- parseUnitProfile(value:unknown):UnitProfile؛unitProfileFromEntity(unit:DemoEntity):UnitProfile (غائب⇒v1فقط)؛unitProfileSummary(unit:DemoEntity):string.
- unitProfileFormValues(unit?:DemoEntity):Record<string,string>؛makeUnitProfile(values:Record<string,string>):UnitProfile.
- createDescribedUnit(state:PrototypeState,propertyId:string,values:Record<string,string>):{state,result:DemoEntity}؛updateDescribedUnit(state,unitId,values):نفسالنتيجة. valuesتحتويtitle/unitCode/electricityNumber/monthlyRentومفاتيحUnitProfile.
- property-fieldsيدعمpropertyProfileJSONكوحدة واحدة اختيارية في المدخل. لا يُسقط metadataقديمة عندالتعديل. ترقيم أولغيرمستخدم عبرnextUnitIdentifier. كهرباء sourceعندغيابالقيمةproperty،عندوجودهاunit. الكهرباء مستقلة عنUnitProfileلاستمرارالعقود. تحديث لا يمس monthlyRentإن لميرسل.

## فريق الصور

يمتلك property-media.ts(إضافةlookupبالIDفقط،لا تغييرالدوالالقديمة)،property-photo-gallery.ts وPhotoGallery.tsx وPhotoGallery.css واختباراتها. العقودshared/photo-gallery-types.ts. مراجع الصور في metadata.photoGallery كسلسلةv1/ids(20كحد)؛الأصلملفاتIndexedDBالحالي. استخراجIDdescriptorيستعملrecordالمخزنمعحراسةscopeوالبايتات،ولايتجاوزملكيةالمساحة.

الدوال parsePhotoGallery(value):PhotoGalleryManifest؛saveTargetPhotoGallery(state,kind:'properties'|'units',id,ids:string[]):{state,result}؛assignUnitPhotoGroup(state,input:AssignUnitPhotoGroupInput):{state,result} ذري. يصحح المستهدف/المحفظة ويحفظ الصور السابقة عندالإضافة. لا يحذف الملفالمرتبط أثناء إزالةمرجع.

المكونات AssetPhotoGallery({kind,id,title})تقرأالحالةبنفسها،تعرضمعرضًاوزرإضافةصورمعinputmultipleوزرإزالةارتباطللصورة. GroupUnitPhotoGallery({propertyId})يوفرانتقاءوحداتالعقاروinputmultipleومراجعةثمإسنادالمجموعةمرةواحدة. تستخدمcommitTransitionونطاقidentity.storageKeyوcanEdit. تحفظملفاتجديدةقبلcommitمعcleanupلها فقطعندفشلscope/role/validation/سعة؛لايمسقديمًا. لا base64باللقطةولاصوربريد/سحابة.

## فريق ربط الواجهة

يمتلكPortfolioPropertyPages.tsx وproperty-sheet.css والجديدUnitDetailsDialog.tsx/css واختباراتالواجهة. يستوردالدوالالمتفقعليها منunit-profileوالمكوناتمنPhotoGallery. يضيفpropertyProfileJSONبنموذجالعقارمنselectهدفومرهونمععرضهمافيالسجل والتفاصيل. يحفظالعقارقبلإضافةصورالمعرض،والصورةالمفردةالحاليةلاتضيع. يستبدل/يعززUnitFormDialogبتجربةوحدةجديدةومحرردونتعديلملفاتالفرق. ربطcreateDescribedUnitوupdateDescribedUnitعبرcommitTransition. يمكنحفظالوحدةقبلرفعصورها،ويُشرحذلكفيالواجهة. يحفظالصورةالفرديةللعقارومخططهالقديمويضعالمعرضبالتفاصيل. يضيفGroupUnitPhotoGalleryبملفالعقار،ومعلوماتالوحدةأرقام/توزيع/تأثيثومعرضهاداخلنافذةتفاصيلوحدة،لاصفحةمكررةبعشراتالحقول.

الأدوار والنطاق محروسةبالمحركوأيضًاالواجهة؛لاكماfinancialبيع/دينأوإشغالمنتحريرالوصف. القديمةغيرمحددة. فحوصمصطنعةلاDBأوبريدأورفعخارجي. لاGitcommitأونشريجريهالأطفال. لا تعديلcontextمشتركبالتوازي؛كلالتغييراتالذريةعبرcommitTransitionالحالي.
