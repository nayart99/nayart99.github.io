# دليل NAY ART – إزاي تدير الموقع

## الدخول على لوحة التحكم
1. افتح **app.pagescms.org**
2. دوس **Sign in with GitHub** وادخل بحساب المتجر.
3. اختار `nay-art`.

أي حاجة تغيّرها وتدوس **Save**، الموقع بيتحدّث لوحده خلال دقيقة تقريبًا.

---

## تغيير سعر لوحة
**Paintings** ← اختار اللوحة ← غيّر **Price** ← Save.
- **Old price before discount**: السعر القديم اللي بيظهر مشطوب. خليه 0 لو مفيش خصم.

## إضافة لوحة جديدة
**Paintings** ← **Add an entry**، واملا:
1. **Link name**: اسم إنجليزي صغير بشرطات، مثلاً `desert-moon` (ده اللي هيظهر في اللينك).
2. **Painting name** و **Short description** و **Long description** بالإنجليزي والعربي.
3. **Price** و **Orientation** (عرضي landscape أو طولي portrait).
4. **Images**: ارفع على الأقل:
   - **Finished painting**: اللوحة متلوّنة
   - **Numbered canvas**: الكانفاس المرقّم الأبيض
   - **Reference sheet**: اللوحة الملوّنة بالأرقام
5. **Position in the shop**: ترتيبها (1 = الأولى).
6. **Show on website**: مفعّلة.

التايم لابس اللي بيلوّن اللوحة بيتعمل لوحده من صورتين اللوحة والكانفاس.

## إخفاء لوحة
افتح اللوحة ← اقفل **Show on website** ← Save.

## الشحن والدفع ورقم الدعم
**Store settings**:
- **Delivery fee**: سعر الشحن.
- **Custom canvas sizes and prices**: مقاسات وأسعار الكستم.
- **Support phone / WhatsApp number**: رقم الدعم.
- **InstaPay / Vodafone Cash**: الحساب اللي بيظهر للعميل بعد ما يختار الطريقة دي.
- **Payment methods**: تشغيل أو إيقاف أي طريقة دفع.
- **Show the launch offer banner**: الشريط اللي فوق.

## الفيديوهات اللي في أول الصفحة
**Home page videos**: غيّر الكلام تحت كل فيديو أو ترتيبهم.
لإضافة فيديو جديد: ارفع ملف `.mp4` (ويُفضّل نسخة `.webm` بنفس الاسم) في `media/video`، وصورة غلاف، واكتب المسار من غير الامتداد، مثلاً `/media/video/new-clip`.
> خلي الفيديو بالطول، أقل من ١٥ ثانية، ومن غير صوت، وحجمه أقل من ٢ ميجا.

## الأسئلة والآراء
- **Questions (FAQ)**: إضافة أو تعديل سؤال بالعربي والإنجليزي.
- **Customer reviews**: حط آراء العملاء الحقيقية، واقفل **Mark as sample reviews**.

## أي كلمة في الموقع
**Website text – English** و **Website text – Arabic**: كل جملة في الموقع موجودة هنا وتقدر تغيّرها.

---

## متابعة الطلبات
كل طلب بيوصل:
1. **إيميل** فيه تفاصيل الطلب.
2. **سطر في شيت `NAY ART Orders`** ← تبويب **Orders**.

في عمود **Status** غيّر حالة الطلب: New ← Confirmed ← Paid ← Shipped ← Delivered (أو Cancelled).
طلبات الكستم: لينك صورة العميل في عمود **Custom photo** (محفوظة في Drive في فولدر *NAY ART – Custom photos*).

## التقارير
- تبويب **Monthly** في نفس الشيت: الطلبات والإيراد ومتوسط الطلب لكل شهر، وأكتر اللوحات مبيعًا.
- تقرير Looker Studio بيوصل على الإيميل أول كل شهر: الزيارات، المصادر، المبيعات، نسبة التحويل.
- **Google Analytics**: الزيارات اللحظية وأكتر الصفحات.
- **Microsoft Clarity**: تتفرج على تسجيلات لحركة الزوار جوه الموقع.
