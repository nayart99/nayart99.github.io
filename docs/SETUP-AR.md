# إعداد موقع NAY ART (مرة واحدة)

كل الحسابات تتعمل على **إيميل المتجر** (الجيميل الجديد) عشان تتسلم للعميل بعدين.

---

## ١. النشر على Cloudflare Pages (مجاني)
1. ادخل **dash.cloudflare.com** واعمل حساب بإيميل المتجر.
2. من القايمة: **Workers & Pages** ← **Create** ← تبويب **Pages** ← **Connect to Git**.
3. اربط حساب GitHub واختار الـ repository `nay-art`.
4. الإعدادات:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
5. دوس **Save and Deploy**. بعد دقيقتين هيبقى الموقع شغال على لينك زي `nay-art.pages.dev`.
6. لو اللينك طلع مختلف، غيّر `site_url` في `src/data/settings.json` (أو من لوحة التحكم ← Store settings).

> أي تعديل يتعمل على GitHub (أو من لوحة التحكم) بيتنشر لوحده خلال دقيقة.

---

## ٢. شيت الطلبات (Google Sheets)
1. ادخل **sheets.google.com** واعمل شيت جديد اسمه `NAY ART Orders`.
2. من فوق: **Extensions** ← **Apps Script**.
3. امسح أي كود موجود، والصق محتوى الملف `apps-script/Code.gs` كله.
4. في أول الكود غيّر `NOTIFY_EMAIL` لإيميل المتجر (أو الإيميل اللي عايز الطلبات توصله).
5. دوس **Save**، وبعدين من القايمة اللي فوق اختار الدالة `setup` ودوس **Run**. وافق على الصلاحيات (Advanced ← Go to project ← Allow).
   هيتعمل في الشيت: Orders و Order items و Subscribers و Monthly، وفولدر في Drive لصور الكستم.
6. **Deploy** ← **New deployment** ← النوع **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. دوس Deploy وانسخ الـ **Web app URL** (بيبدأ بـ `https://script.google.com/macros/s/...`).
8. حطه في `orders_endpoint` في الإعدادات (لوحة التحكم ← Store settings ← Orders web app link).

**من غير الخطوة دي** الموقع شغال برضه: العميل بعد ما يأكد الطلب بيظهرله زرار "ابعت الطلب على واتساب" والطلب كله مكتوب في الرسالة.

> لو عدّلت الكود بعدين: Deploy ← Manage deployments ← Edit ← Version: New version. اللينك بيفضل زي ما هو.

---

## ٣. الزيارات والتتبع
| الأداة | بتعمل إيه | تحطه فين |
|---|---|---|
| **Google Analytics 4** (analytics.google.com) | عدد الزوار، جايين منين، مين اشترى، أكتر لوحة اتشافت | الـ ID اللي بيبدأ بـ `G-` في Store settings ← Google Analytics ID |
| **Microsoft Clarity** (clarity.microsoft.com) | تسجيلات لحركة الزوار وخرايط الضغط | Project ID في Clarity project ID |
| **Meta Pixel** (business.facebook.com ← Events Manager) | تتبع الإعلانات وعمل جماهير إعادة استهداف | Pixel ID في Meta Pixel ID |

الموقع بيبعت أحداث جاهزة لـ GA4 وMeta: مشاهدة منتج، إضافة للسلة، بدء الدفع، شراء (بالقيمة)، تواصل (اتصال/واتساب)، رفع صورة كستم.
وكل طلب في الشيت مكتوب جنبه المصدر (utm_source / campaign) عشان تعرف الإعلان اللي جاب البيعة.

> في GA4: Admin ← Events ← علّم `purchase` كـ **Key event** عشان يظهر في التقارير كـ تحويل.

---

## ٤. جوجل والـ SEO (Search Console)
1. ادخل **search.google.com/search-console** ← Add property ← **URL prefix** ← لينك الموقع.
2. اختار طريقة **HTML tag**، وانسخ الكود اللي جوه `content="..."` بس.
3. حطه في Store settings ← Google Search Console verification code، واستنى النشر (دقيقة)، وبعدين دوس Verify.
4. من Sitemaps ابعت: `sitemap.xml`
5. بعد كده: **Google Business Profile** (business.google.com) باسم NAY ART ولينك الموقع ورقم الدعم.

الموقع جاهز من ناحيته: كل لوحة ليها صفحة بلينك خاص (إنجليزي وعربي)، عنوان ووصف لكل صفحة، بيانات منتج لجوجل (السعر والتوفر)، صورة مشاركة، sitemap و robots.txt.

---

## ٥. التقرير الشهري (Looker Studio – مجاني)
1. ادخل **lookerstudio.google.com** ← Blank report.
2. أضف مصدرين للبيانات:
   - **Google Analytics** ← الـ property بتاع الموقع (زيارات، مصادر، أجهزة).
   - **Google Sheets** ← `NAY ART Orders` ← شيت **Orders** (مبيعات) و **Order items** (المنتجات).
3. حط في الصفحة: زيارات الشهر، عدد الطلبات، الإيراد، متوسط الطلب، نسبة التحويل (طلبات ÷ زيارات)، أكتر اللوحات مبيعًا، المبيعات حسب المصدر، والمحافظات.
4. من فوق: **Share** ← **Schedule delivery** ← اختار إيميلات الإدارة والعميل ← Monthly ← أول يوم في الشهر.

وفي نفس الوقت شيت **Monthly** جوه ملف الطلبات بيحسب لوحده: عدد الطلبات والإيراد والوحدات ومتوسط الطلب لكل شهر، وأكتر المنتجات مبيعًا.

---

## ٦. الدومين (بعدين)
1. اشتري الدومين باسم العميل (Namecheap / GoDaddy / Cloudflare Registrar).
2. Cloudflare Pages ← المشروع ← **Custom domains** ← Set up a domain ← اتبع الخطوات.
3. غيّر `site_url` في الإعدادات للدومين الجديد.
4. في Search Console ضيف الدومين الجديد وابعت الـ sitemap تاني.

---

## ٧. لوحة التحكم للعميل
1. ادخل **app.pagescms.org** ← Sign in with GitHub (بحساب المتجر).
2. اختار الـ repository `nay-art`. هتظهر الأقسام: Paintings، Store settings، Home page videos، FAQ، Customer reviews، Website text.
3. لما تسلّم للعميل: GitHub ← الـ repo ← Settings ← Collaborators ← ضيفه، أو انقل ملكية الحساب كله له.
