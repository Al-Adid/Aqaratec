# Read-only review — property location, media, and unit bulk fill

## Confirmed blocker

### Legacy media descriptors bypass the total attachment caps

**Files:** `client/src/components/app/PropertyMediaEditor.tsx:471-485`, `client/src/components/app/PropertyMediaEditor.tsx:657-667`

`chooseFiles()` counts only `photoIds` / `planIds` when enforcing `MAX_PROPERTY_MEDIA_PHOTOS` and `MAX_PROPERTY_MEDIA_PLANS`. It does not count the compatible legacy `photo` / `plan` descriptor, which `cloneManifest()` preserves and `performPrepare()` keeps while appending the new opaque IDs.

**Reproduction:** Open a property whose existing `propertyMedia` is `{ "v": 1, "photo": <valid legacy descriptor> }`. Select 20 valid new photos and save. The limit check accepts the selection (`0 + 20 <= 20`), and the saved manifest contains the legacy `photo` plus 20 `photoIds`: 21 visible photos. The equivalent plan path permits one legacy `plan` plus 10 `planIds`: 11 plans. This contradicts the declared/user-facing maximums of 20 photos and 10 plans.

## Limitations

This was a bounded source review of the current uncommitted diff and the requested critical paths only. It used no browser, made no database writes, made no application-code edits, and did not rerun the typecheck or test suite; the reported clean typecheck and 82 affected passing tests were treated as supplied evidence.

## إغلاق الملاحظة — 27 أكتوبر، 12:24

أُغلق تجاوز العدد الكلي: يجمع المدقق ومعالج الاختيار المعرفات الجديدة مع معرف الصورة أو المخطط القديم، مع إزالة التكرار حسب المعرف. يرفض المدقق 21 صورة أو 11 مخططًا، ويرفض المحرر الاختيار الزائد قبل التحقق من الملفات أو كتابة Bytes، دون تنظيف المرجع القديم. أضيف اختبار مجال للحدود واختبارا واجهة للصورة والمخطط. نجحت مجموعة الإغلاق: 21 اختبارًا في ثلاثة ملفات، مع فحص TypeScript وبناء نهائي ناجحين. لا ادعاء بإعادة مراجعة مستقلة؛ هذا إغلاق محدد بالأدلة.

كما أُغلق انحدار الغلاف: يقرأ PropertyCover صور photoIds الجديدة بعد المرجع القديم وقبل معرض الصور المنفصل، وتثبت حالة واجهة جديدة ظهور الصورة دون مرجع قديم أو معرض آخر.
