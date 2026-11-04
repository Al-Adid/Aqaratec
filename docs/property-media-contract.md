# عقد تحديث العقارات والمحافظ

الواجهة يملكها وكيل في PortfolioPropertyPages.tsx وproperty-sheet.css فقط. الوالد يملك property-fields.ts وPrototypeContext وlib/property-media.ts وlib/prototype-asset-removal.ts والمكونات الجديدة واختباراتها. لا SQL ولا مزود ولا حذف بيانات أثناءالاختبار.

lib/property-media.ts API:
- parsePropertyMedia(value: unknown): PropertyMediaManifest (blank gives {v:1}; invalid throws Arabic error)
- serializePropertyMedia(manifest:PropertyMediaManifest):string (empty gives ""; max1024)
- validatePropertyMediaFile(file:File,kind:PropertyMediaKind):Promise<void> (images≤5MiB photo, images/PDF≤10MiB plan; bytes signature, MIME)
- storePropertyMedia(scopeKey:string,kind:PropertyMediaKind,file:File):Promise<PropertyMediaDescriptor> (private IndexedDB local; no upload)
- loadPropertyMedia(scopeKey:string,descriptor:PropertyMediaDescriptor,kind:PropertyMediaKind):Promise<Blob|null> (other namespace/missing null)
- discardPropertyMedia(scopeKey:string,id:string):Promise<void> (only pending files on failed commit; never old referenced assets).

المكونات التي ينشئها الوالد:
PropertyMediaEditor({value:string,onChange:(value:string)=>void,onBusyChange?:(busy:boolean)=>void,disabled?:boolean}): قيمتهmanifestJSON، اختيارالملف يخزنblob pendingفيذاكرةجلسةالمكونولاIndexedDBحتىالحفظ. flush API أبسط: onChange لايصدر descriptorقبل الحفظ؛ الوكيل يستعمل refمننوعPropertyMediaEditorHandle: prepare():Promise<string>,rollback():Promise<void> كي يحفظpending الملفاتقبلonSubmitويتنظفالفشل، وcancel لايحفظ. يُحافظعلىقيمةقديمة إذالاملفجديد. scope منusePrototype.identity.storageKey. Prepareفيالوعد يتحققscope/canEdit الحاليين. onChange يصدرmanifestعندحذفمرجعحتىيمكنتحديثvalues، لكنالحذفلايصيرعلىالسجلإلابالحفظ. المكونينشئمعاينةblobURLويردعذلكعندإلغائه. onSubmit يصبحasync ويحرسdoubleclick، لا إغلاقحتىsuccess. prepareيجبأنيدعىقبلvalues إلىcreate/update.
PropertyMediaDisplay({value:unknown,title:string}):contextscope، يعرضphoto/missingوplanالمحليمعزرمعاينة/تنزيل؛ PDFيفتحبnoopener. قيدعدم نقلالملفاتبالـJSONوالسحابةظاهر. لايستعملfallbackوهميبوجودمرجعمفقود.
AssetRemovalButton({kind:"properties"|"portfolios",id:string,title:string}): يرىcanEdit، يفحصالعلاقات، حوارconfirmationwithtypedname، يناديusePrototype.removeAsset(kind,id). الولديركبهفيصفالعقار، تفاصيله، بطاقةالمحفظة؛ route /portfoliosمتاحورابطمنالعقارات. عندحذفالتفاصيل يرجعلـ/propertiesبعدنجاحفقط، المكونيتكفلذلكviaredirectTo?:string.

حقلvalues.propertyMedia (JSON≤1024) يمررهproperty-fieldsإلىmeta.propertyMedia؛ فيالقراءةvaluesFromProperty ينسخه بلا تخمين. planNumberينسخإلىmeta.planNumberومرجعplanRefللتوافق؛ يظهرحقل«رقم المخطط»خارجتفاصيلاختيارية ويحذف«مرجع المخطط»المكرر. قراءةرقممنplanNumber??planRef تحفظالنص. حقلpropertyMediaليسinputfileserializedوحده.

المرفقاتمحليةحقيقيةبمتصفحواحد،لاخزنةملفاتإنتاجية. تعرضالقيودبوضوح. metadataJSONلايشملblob/dataURLولاURLعامًا. الملفاتالقديمةتبقىللقطاتقديمة؛ لا يُدَّعىمحوفعلي.
