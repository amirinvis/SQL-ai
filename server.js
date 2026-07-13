require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const AdmZip = require("adm-zip");
const { Mistral } = require("@mistralai/mistralai");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.MISTRAL_API_KEY) {
  console.warn(
    "⚠️  MISTRAL_API_KEY تنظیم نشده است. فایل .env.example را کپی کرده و به .env تغییر نام دهید، سپس کلید خود را وارد کنید."
  );
}

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

app.use(cors());
app.use(express.json({ limit: "20mb" })); // عکس‌های base64 حجیم‌تر از متن هستند
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// ---------------------------------------------------------------------------
// سیستم پرامپت: دستیار را منحصراً به SQL Server و Power BI محدود می‌کند
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `تو یک دستیار هوش مصنوعی متخصص و باتجربه در دو حوزه هستی:
1) SQL Server (T-SQL، طراحی دیتابیس، ایندکس‌گذاری، بهینه‌سازی کوئری، Stored Procedure، Trigger، مدیریت و ادمین SQL Server)
2) Power BI (Power Query/M، DAX، مدل‌سازی داده، طراحی داشبورد، ارتباط بین جداول، Row-Level Security، بهترین شیوه‌های گزارش‌سازی)

قوانین رفتار تو:
- فقط و فقط به سوالات مرتبط با SQL Server و Power BI (و مباحث نزدیک مثل ETL، مدل‌سازی داده، انبار داده، DAX، T-SQL) پاسخ بده.
- اگر سوالی کاملاً خارج از این حوزه بود (مثلاً موضوعات عمومی، سیاسی، شخصی و غیرمرتبط)، مؤدبانه توضیح بده که تخصص تو فقط SQL Server و Power BI است و کاربر را به سوال مرتبط راهنمایی کن.
- وقتی کاربر فایلی (اسکریپت SQL، فایل Power BI، CSV و...) آپلود کرده، محتوای استخراج‌شده از آن فایل در پیام سیستم زیر پیوست خواهد شد. از این اطلاعات برای پاسخ دقیق و مرتبط با همان فایل استفاده کن، جداول، کوئری‌ها یا ساختار داده را تحلیل کن و در صورت نیاز پیشنهاد بهبود بده.
- برای فایل‌های .pbix، اطلاعات استخراج‌شده شامل فهرست صفحات گزارش، نوع هر ویژوال (مثل نمودار ستونی، دایره‌ای، جدول، اسلایسر و...)، عنوان و فیلدهای استفاده‌شده در هر ویژوال است. وقتی کاربر درباره‌ی «چه ویژوال‌هایی استفاده شده» یا «طراحی داشبورد» سوال می‌پرسد، از همین فهرست دقیق استفاده کن و در صورت لزوم نقد یا پیشنهاد بهتر برای انتخاب نوع نمودار بده.
- کاربر ممکن است تصویری از یک صفحه/فرم نرم‌افزار، طرح ذهنی (wireframe/mockup)، دیاگرام ER، اسکرین‌شات یک گزارش موجود، یا حتی عکس دست‌نویس از ساختار داده بفرستد. در این حالت تصویر را با دقت تحلیل کن: موجودیت‌ها (Entity)، فیلدها، روابط بین آن‌ها، و نوع داده‌های محتمل را استخراج کن. سپس بر اساس همان تحلیل:
  1) یک اسکریپت کامل T-SQL برای ساخت دیتابیس در SQL Server بنویس (CREATE TABLE با کلید اصلی/خارجی مناسب، نوع داده منطقی، و در صورت نیاز داده نمونه با INSERT).
  2) راهنمایی مشخص برای ساخت مدل و گزارش در Power BI بر اساس همان ساختار بده (چه جداولی را Import/DirectQuery کند، چه روابطی بین جداول بسازد، چه ویژوال‌هایی برای نمایش این داده مناسب‌تر است).
  اگر تصویر مبهم یا ناقص بود، فرضیات معقول خودت را صریح اعلام کن و از کاربر برای جزئیات گم‌شده (مثل نوع دقیق فیلدها) سوال بپرس.
- پاسخ‌ها را به زبان فارسی، حرفه‌ای، دقیق و قابل فهم بنویس مگر کاربر زبان دیگری استفاده کند.
- کد T-SQL یا DAX را همیشه در بلاک کد (code block) با فرمت مناسب ارائه بده.
- اگر مطمئن نیستی یا اطلاعات کافی نداری، صادقانه بگو و بهترین حدس یا راه‌حل جایگزین را پیشنهاد بده.`;

// ---------------------------------------------------------------------------
// استخراج متن از فایل‌های آپلودی
// ---------------------------------------------------------------------------
function extractFromTextFile(buffer) {
  return buffer.toString("utf-8");
}

// نگاشت نام فنی ویژوال‌های Power BI به نام قابل‌فهم فارسی
const VISUAL_TYPE_MAP = {
  clusteredColumnChart: "نمودار ستونی خوشه‌ای",
  clusteredBarChart: "نمودار میله‌ای خوشه‌ای",
  stackedColumnChart: "نمودار ستونی پشته‌ای",
  stackedBarChart: "نمودار میله‌ای پشته‌ای",
  hundredPercentStackedColumnChart: "نمودار ستونی پشته‌ای ۱۰۰٪",
  hundredPercentStackedBarChart: "نمودار میله‌ای پشته‌ای ۱۰۰٪",
  columnChart: "نمودار ستونی",
  barChart: "نمودار میله‌ای",
  lineChart: "نمودار خطی",
  areaChart: "نمودار ناحیه‌ای",
  stackedAreaChart: "نمودار ناحیه‌ای پشته‌ای",
  lineStackedColumnComboChart: "نمودار ترکیبی خط و ستون پشته‌ای",
  lineClusteredColumnComboChart: "نمودار ترکیبی خط و ستون خوشه‌ای",
  pieChart: "نمودار دایره‌ای",
  donutChart: "نمودار حلقه‌ای (Donut)",
  treemap: "نمودار درختی (Treemap)",
  funnel: "نمودار قیفی (Funnel)",
  gauge: "گیج (Gauge)",
  waterfallChart: "نمودار آبشاری (Waterfall)",
  ribbonChart: "نمودار روبانی (Ribbon)",
  scatterChart: "نمودار پراکندگی (Scatter)",
  table: "جدول (Table)",
  tableEx: "جدول (Table)",
  pivotTable: "جدول ماتریسی (Matrix)",
  matrix: "جدول ماتریسی (Matrix)",
  card: "کارت KPI تک‌مقداری",
  multiRowCard: "کارت چندردیفی",
  kpi: "شاخص KPI",
  slicer: "اسلایسر / فیلتر تعاملی",
  map: "نقشه (Map)",
  filledMap: "نقشه رنگی (Filled Map)",
  shapeMap: "نقشه شکلی (Shape Map)",
  azureMap: "نقشه Azure",
  textbox: "جعبه متن",
  image: "تصویر",
  actionButton: "دکمه اکشن",
  shape: "شکل گرافیکی",
  decompositionTreeVisual: "درخت تجزیه (Decomposition Tree)",
  keyDriversVisual: "تحلیل عوامل کلیدی (Key Influencers)",
  qnaVisual: "پرسش و پاسخ (Q&A)",
  scriptVisual: "ویژوال R/Python سفارشی",
  cardVisual: "کارت",
};

function visualLabel(type) {
  return VISUAL_TYPE_MAP[type] || `ویژوال از نوع "${type}"`;
}

// تلاش برای استخراج نام فیلدهای استفاده‌شده در یک ویژوال از روی prototypeQuery
function extractFieldsFromVisual(singleVisual) {
  const fields = new Set();
  try {
    const selects = singleVisual?.prototypeQuery?.Select || [];
    selects.forEach((sel) => {
      if (sel?.Name) fields.add(sel.Name);
      else if (sel?.Column?.Property) fields.add(sel.Column.Property);
      else if (sel?.Aggregation?.Expression?.Column?.Property)
        fields.add(sel.Aggregation.Expression.Column.Property);
    });
  } catch (e) {
    /* بی‌خطر رد شو */
  }
  // منبع دوم و معمولاً خواناتر: کلیدهای columnProperties مثل "Sum(Sales.Amount)"
  try {
    const colProps = singleVisual?.columnProperties;
    if (colProps) Object.keys(colProps).forEach((k) => fields.add(k));
  } catch (e) {}
  return Array.from(fields);
}

function extractVisualTitle(singleVisual) {
  try {
    const titleObj = singleVisual?.vcObjects?.title?.[0]?.properties?.text?.expr?.Literal?.Value;
    if (titleObj) return String(titleObj).replace(/^'(.*)'$/, "$1");
  } catch (e) {}
  return null;
}

function parseLayoutJson(rawText) {
  const layout = JSON.parse(rawText);
  const sections = layout.sections || [];

  let totalVisuals = 0;
  const pageSummaries = sections.map((section, pageIdx) => {
    const pageName = section.displayName || section.name || `صفحه ${pageIdx + 1}`;
    const containers = section.visualContainers || [];

    const visualLines = [];
    containers.forEach((vc) => {
      try {
        const cfg = JSON.parse(vc.config);
        const sv = cfg.singleVisual;
        if (!sv) return; // گروه‌بندی بصری یا عنصر بدون نوع مشخص
        totalVisuals++;
        const label = visualLabel(sv.visualType);
        const title = extractVisualTitle(sv);
        const fields = extractFieldsFromVisual(sv);
        let line = `  • ${label}`;
        if (title) line += ` — عنوان: «${title}»`;
        if (fields.length) line += ` — فیلدها: ${fields.slice(0, 8).join(", ")}`;
        visualLines.push(line);
      } catch (e) {
        /* این ویژوال خاص قابل پارس نبود، رد شو */
      }
    });

    return `صفحه «${pageName}» (${toFaCount(visualLines.length)} ویژوال):\n${
      visualLines.length ? visualLines.join("\n") : "  (ویژوالی قابل شناسایی نبود)"
    }`;
  });

  return {
    pageCount: sections.length,
    totalVisuals,
    summaryText: pageSummaries.join("\n\n"),
  };
}

function toFaCount(n) {
  return String(n);
}

function extractFromPbix(buffer) {
  let details = "";
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    return `فایل .pbix دریافت شد اما امکان باز کردن آن به‌عنوان فایل فشرده نبود (خطا: ${err.message}).`;
  }

  const entries = zip.getEntries();
  const layoutEntry = entries.find((e) => e.entryName === "Report/Layout");

  if (!layoutEntry) {
    return `فایل .pbix دریافت شد اما بخش Report/Layout در آن پیدا نشد، بنابراین امکان شناسایی ویژوال‌ها نبود. فهرست بخش‌های داخلی فایل:\n- ${entries
      .map((e) => e.entryName)
      .join("\n- ")}`;
  }

  // Layout معمولاً UTF-16LE است؛ اگر نشد UTF-8 را هم امتحان می‌کنیم
  let parsed = null;
  for (const enc of ["utf-16le", "utf-8"]) {
    try {
      const text = layoutEntry.getData().toString(enc).replace(/^\uFEFF/, "");
      parsed = parseLayoutJson(text);
      break;
    } catch (e) {
      continue;
    }
  }

  if (!parsed) {
    return `فایل .pbix دریافت شد، اما ساختار Layout آن با الگوی شناخته‌شده مطابقت نداشت (احتمالاً نسخه‌ای متفاوت از فرمت است). می‌توانید کوئری‌های DAX/M را جداگانه به‌صورت فایل متنی آپلود کنید.`;
  }

  details += `فایل Power BI با موفقیت تحلیل شد.\n`;
  details += `تعداد صفحات گزارش: ${parsed.pageCount} | تعداد کل ویژوال‌ها: ${parsed.totalVisuals}\n\n`;
  details += parsed.summaryText;
  details += `\n\n(توجه: مدل داده و فرمول‌های DAX در فایل pbix به‌صورت باینری فشرده ذخیره می‌شوند و در این تحلیل استخراج نشدند. برای بررسی دقیق DAX، فرمول‌ها را جداگانه به‌صورت فایل .dax یا .txt آپلود کنید.)`;

  return details;
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

function isImageFile(originalname) {
  return IMAGE_EXTENSIONS.includes(path.extname(originalname).toLowerCase());
}

function extractContent(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  switch (ext) {
    case ".sql":
    case ".txt":
    case ".dax":
    case ".m":
    case ".csv":
    case ".json":
      return extractFromTextFile(file.buffer);
    case ".pbix":
      return extractFromPbix(file.buffer);
    default:
      return `نوع فایل "${ext}" به‌طور کامل پشتیبانی نمی‌شود. فرمت‌های پیشنهادی: .sql .txt .dax .m .csv .json .pbix`;
  }
}

// ---------------------------------------------------------------------------
// روت آپلود فایل
// ---------------------------------------------------------------------------
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "فایلی ارسال نشده است." });
  }

  // ------- حالت تصویر: برای تحلیل بصری (mockup/ERD/اسکرین‌شات) -------
  if (isImageFile(req.file.originalname)) {
    try {
      const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      return res.json({
        filename: req.file.originalname,
        size: req.file.size,
        isImage: true,
        dataUrl,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "خطا در پردازش تصویر: " + err.message });
    }
  }

  // ------- حالت فایل متنی/pbix معمول -------
  try {
    const content = extractContent(req.file);
    const MAX_CHARS = 12000; // جلوگیری از سنگین شدن بیش از حد پیام به مدل
    const trimmed =
      content.length > MAX_CHARS
        ? content.slice(0, MAX_CHARS) + "\n\n...[متن به دلیل حجم زیاد کوتاه شد]"
        : content;

    res.json({
      filename: req.file.originalname,
      size: req.file.size,
      isImage: false,
      extractedText: trimmed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در پردازش فایل: " + err.message });
  }
});

// ---------------------------------------------------------------------------
// روت گفتگو با هوش مصنوعی
// ---------------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { messages, fileContext } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "پیام‌ها ارسال نشده‌اند." });
  }

  if (!process.env.MISTRAL_API_KEY) {
    return res.status(500).json({
      error:
        "کلید API تنظیم نشده است. فایل .env را طبق راهنمای README بسازید.",
    });
  }

  try {
    let systemContent = SYSTEM_PROMPT;
    if (fileContext) {
      systemContent += `\n\n---\nمحتوای استخراج‌شده از فایل آپلود شده توسط کاربر:\n${fileContext}\n---`;
    }

    const apiMessages = [
      { role: "system", content: systemContent },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // اگر هر یک از پیام‌ها شامل تصویر باشد (content به‌صورت آرایه با image_url)،
    // باید از یک مدل دارای قابلیت vision استفاده کنیم؛ در غیر این صورت مدل متنی سبک‌تر کافی است.
    const hasImage = apiMessages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((part) => part.type === "image_url")
    );
    const model = hasImage ? "mistral-medium-latest" : "mistral-small-latest";

    const result = await mistral.chat.complete({
      model,
      messages: apiMessages,
    });

    const reply = result.choices?.[0]?.message?.content ?? "";
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطا در ارتباط با Mistral AI: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ سرور روی http://localhost:${PORT} در حال اجراست`);
});