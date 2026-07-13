(() => {
  const chatEl = document.getElementById("chat");
  const composer = document.getElementById("composer");
  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListEl = document.getElementById("fileList");
  const pendingImagesEl = document.getElementById("pendingImages");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const clearBtn = document.getElementById("clearBtn");
  const newChatBtn = document.getElementById("newChatBtn");
  const convListEl = document.getElementById("convList");

  const persianDigits = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
  const toFa = (n) => String(n).replace(/\d/g, (d) => persianDigits[d]);

  const WELCOME_TEXT =
    "سلام 👋 من دستیار تخصصی SQL Server و Power BI هستم. می‌توانید سوال بپرسید یا یک فایل (اسکریپت SQL، DAX، M، عکس طرح یا حتی .pbix) از پنل کناری آپلود کنید تا دقیق‌تر و بر اساس همان کمک کنم.";

  let history = []; // {role, content}  -- پیام‌های ارسالی به مدل
  let attachedFiles = []; // {filename, extractedText}
  let pendingImages = []; // {filename, dataUrl}
  let rowCounter = 1;

  let currentConvId = null;
  let currentConvTitle = "چت جدید";
  let currentConvCreatedAt = Date.now();

  // ================= ذخیره‌سازی گفتگوها (localStorage) =================
  const STORAGE_PREFIX = "sqlbiAssistant.";
  const IDX_KEY = STORAGE_PREFIX + "index";
  const CURRENT_KEY = STORAGE_PREFIX + "currentId";
  const convKey = (id) => STORAGE_PREFIX + "conv." + id;

  function genId() {
    return window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : "c" + Date.now() + Math.random().toString(16).slice(2);
  }

  function readIndex() {
    try {
      return JSON.parse(localStorage.getItem(IDX_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function writeIndex(idx) {
    try {
      localStorage.setItem(IDX_KEY, JSON.stringify(idx));
    } catch (e) {
      console.warn("ذخیره فهرست گفتگوها ناموفق بود", e);
    }
  }

  function readConversation(id) {
    try {
      return JSON.parse(localStorage.getItem(convKey(id)));
    } catch (e) {
      return null;
    }
  }

  function writeConversation(conv) {
    try {
      localStorage.setItem(convKey(conv.id), JSON.stringify(conv));
    } catch (e) {
      console.warn("ذخیره گفتگو ناموفق بود (احتمالاً حافظه مرورگر پر شده)", e);
      setBusy(false, "⚠️ حافظه مرورگر پر است — گفتگوهای قدیمی را حذف کنید");
      return;
    }
    const idx = readIndex();
    const existing = idx.find((c) => c.id === conv.id);
    if (existing) {
      existing.title = conv.title;
      existing.updatedAt = conv.updatedAt;
    } else {
      idx.push({ id: conv.id, title: conv.title, updatedAt: conv.updatedAt });
    }
    writeIndex(idx);
    renderConversationList();
  }

  function deleteConversationStorage(id) {
    localStorage.removeItem(convKey(id));
    writeIndex(readIndex().filter((c) => c.id !== id));
  }

  function saveCurrentConversation() {
    if (!currentConvId) return;
    const conv = {
      id: currentConvId,
      title: currentConvTitle,
      createdAt: currentConvCreatedAt,
      updatedAt: Date.now(),
      messages: history,
      attachedFiles: attachedFiles,
    };
    writeConversation(conv);
    localStorage.setItem(CURRENT_KEY, currentConvId);
  }

  function maybeSetTitleFromText(text) {
    if (currentConvTitle === "چت جدید" && text) {
      currentConvTitle = text.length > 40 ? text.slice(0, 40) + "…" : text;
    }
  }

  function splitContent(content) {
    if (Array.isArray(content)) {
      const textPart = content.find((p) => p.type === "text");
      const images = content.filter((p) => p.type === "image_url").map((p) => p.imageUrl);
      return { text: textPart ? textPart.text : "", images };
    }
    return { text: content, images: [] };
  }

  function renderConversationList() {
    const idx = readIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
    convListEl.innerHTML = "";
    idx.forEach((c) => {
      const item = document.createElement("div");
      item.className = "conv-item" + (c.id === currentConvId ? " active" : "");

      const titleEl = document.createElement("span");
      titleEl.className = "conv-title";
      titleEl.textContent = c.title || "چت جدید";
      titleEl.title = c.title || "چت جدید";
      titleEl.addEventListener("click", () => {
        if (c.id !== currentConvId) switchToConversation(c.id);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "conv-delete";
      delBtn.setAttribute("aria-label", "حذف گفتگو");
      delBtn.textContent = "×";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm("این گفتگو برای همیشه حذف شود؟")) return;
        deleteConversationStorage(c.id);
        if (c.id === currentConvId) {
          const remaining = readIndex();
          if (remaining.length > 0) {
            const latest = remaining.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
            switchToConversation(latest.id);
          } else {
            startNewConversation();
          }
        } else {
          renderConversationList();
        }
      });

      item.appendChild(titleEl);
      item.appendChild(delBtn);
      convListEl.appendChild(item);
    });
  }

  function resetChatUI() {
    rowCounter = 1;
    renderFileList();
    renderPendingImages();
    chatEl.innerHTML = "";
  }

  function startNewConversation() {
    currentConvId = genId();
    currentConvTitle = "چت جدید";
    currentConvCreatedAt = Date.now();
    history = [];
    attachedFiles = [];
    pendingImages = [];
    resetChatUI();
    addMessage("ai", WELCOME_TEXT);
    saveCurrentConversation();
    renderConversationList();
  }

  function switchToConversation(id) {
    const conv = readConversation(id);
    if (!conv) {
      startNewConversation();
      return;
    }
    currentConvId = conv.id;
    currentConvTitle = conv.title || "چت جدید";
    currentConvCreatedAt = conv.createdAt || Date.now();
    history = conv.messages || [];
    attachedFiles = conv.attachedFiles || [];
    pendingImages = [];
    resetChatUI();

    if (history.length === 0) {
      addMessage("ai", WELCOME_TEXT);
    } else {
      history.forEach((msg) => {
        const { text, images } = splitContent(msg.content);
        addMessage(msg.role === "assistant" ? "ai" : "user", text, { images });
      });
    }
    localStorage.setItem(CURRENT_KEY, currentConvId);
    renderConversationList();
  }

  // ---------------- helpers ----------------
  function setBusy(isBusy, label) {
    statusDot.classList.toggle("busy", isBusy);
    statusText.textContent = label || (isBusy ? "در حال پردازش…" : "آماده به کار");
    sendBtn.disabled = isBusy;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // بسیار ساده: تبدیل بلاک‌های کد ```...``` و `code` به HTML
  function renderMarkdownLite(text) {
    let escaped = escapeHtml(text);
    escaped = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      const cleaned = code.replace(/^[a-zA-Z]*\n/, "");
      return `<pre><code>${cleaned}</code></pre>`;
    });
    escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return escaped;
  }

  // کپی متن در کلیپ‌بورد با نمایش بازخورد کوتاه روی دکمه
  function copyText(text, btnEl, idleHtml, doneHtml) {
    const finish = (ok) => {
      if (!btnEl) return;
      btnEl.innerHTML = ok ? doneHtml : "خطا";
      btnEl.classList.toggle("copied", ok);
      setTimeout(() => {
        btnEl.innerHTML = idleHtml;
        btnEl.classList.remove("copied");
      }, 1500);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => finish(true)).catch(() => finish(false));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      finish(ok);
    }
  }

  // به هر بلاک کد داخل یک پیام، دکمه کپی مخصوص خودش اضافه می‌کند
  function attachCodeCopyButtons(container) {
    container.querySelectorAll("pre").forEach((preEl) => {
      const codeEl = preEl.querySelector("code");
      if (!codeEl) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy-btn";
      btn.textContent = "کپی";
      btn.addEventListener("click", () =>
        copyText(codeEl.textContent, btn, "کپی", "کپی شد ✓")
      );
      preEl.appendChild(btn);
    });
  }

  function addMessage(role, content, { thinking = false, images = [] } = {}) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${role === "user" ? "msg-user" : "msg-ai"}`;

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.innerHTML = `
      <span class="msg-tag ${role === "user" ? "tag-user" : "tag-ai"}">${role === "user" ? "شما" : "AI"}</span>
      <span class="msg-row">${toFa(String(rowCounter).padStart(2, "0"))}</span>
    `;
    rowCounter++;

    const body = document.createElement("div");
    body.className = "msg-body" + (thinking ? " thinking" : "");
    body.innerHTML = thinking ? content : renderMarkdownLite(content);

    if (role === "ai" && !thinking) {
      attachCodeCopyButtons(body);
    }

    images.forEach((dataUrl) => {
      const img = document.createElement("img");
      img.className = "msg-image";
      img.src = dataUrl;
      body.appendChild(img);
    });

    if (role === "ai") {
      const copyMsgBtn = document.createElement("button");
      copyMsgBtn.type = "button";
      copyMsgBtn.className = "msg-copy-btn";
      copyMsgBtn.innerHTML = "کپی پاسخ";
      copyMsgBtn.addEventListener("click", () =>
        copyText(body.textContent.trim(), copyMsgBtn, "کپی پاسخ", "کپی شد ✓")
      );
      meta.appendChild(copyMsgBtn);
    }

    wrap.appendChild(meta);
    wrap.appendChild(body);
    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
    return body;
  }

  function autoresize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }
  input.addEventListener("input", autoresize);

  // ---------------- file upload ----------------
  function renderFileList() {
    fileListEl.innerHTML = "";
    attachedFiles.forEach((f, idx) => {
      const chip = document.createElement("div");
      chip.className = "file-chip active";
      chip.innerHTML = `
        <span class="fname" title="${f.filename}">${f.filename}</span>
        <button aria-label="حذف فایل" data-idx="${idx}">×</button>
      `;
      chip.querySelector("button").addEventListener("click", () => {
        attachedFiles.splice(idx, 1);
        renderFileList();
        saveCurrentConversation();
      });
      fileListEl.appendChild(chip);
    });
  }

  function renderPendingImages() {
    pendingImagesEl.innerHTML = "";
    pendingImages.forEach((img, idx) => {
      const thumb = document.createElement("div");
      thumb.className = "pending-thumb";
      thumb.innerHTML = `
        <img src="${img.dataUrl}" alt="${img.filename}" />
        <button aria-label="حذف عکس" data-idx="${idx}">×</button>
      `;
      thumb.querySelector("button").addEventListener("click", () => {
        pendingImages.splice(idx, 1);
        renderPendingImages();
      });
      pendingImagesEl.appendChild(thumb);
    });
  }

  async function uploadFile(file) {
    setBusy(true, `در حال خواندن ${file.name}…`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطای نامشخص");

      if (data.isImage) {
        pendingImages.push({ filename: data.filename, dataUrl: data.dataUrl });
        renderPendingImages();
        addMessage(
          "ai",
          `عکس «${data.filename}» آماده ارسال است. یک توضیح یا سوال بنویسید (مثلاً «برای این طرح دیتابیس و گزارش Power BI بساز») و دکمه ارسال را بزنید.`
        );
      } else {
        attachedFiles.push({ filename: data.filename, extractedText: data.extractedText });
        renderFileList();
        addMessage(
          "ai",
          `فایل «${data.filename}» با موفقیت خوانده شد و به‌عنوان زمینه (context) در گفتگو در دسترس است. حالا می‌توانید درباره‌ی محتوای آن سوال بپرسید.`
        );
        saveCurrentConversation();
      }
    } catch (err) {
      addMessage("ai", `⚠️ خطا در آپلود فایل: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) uploadFile(fileInput.files[0]);
    fileInput.value = "";
  });
  ["dragover", "dragenter"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  });

  // ---------------- chat ----------------
  function buildFileContext() {
    if (attachedFiles.length === 0) return null;
    return attachedFiles
      .map((f) => `### فایل: ${f.filename}\n${f.extractedText}`)
      .join("\n\n");
  }

  async function sendMessage(text) {
    const imagesToSend = pendingImages.slice();
    const displayText = text || "این تصویر را تحلیل کن و بر اساس آن دیتابیس و گزارش Power BI پیشنهاد بده.";

    maybeSetTitleFromText(displayText);
    addMessage("user", displayText, { images: imagesToSend.map((i) => i.dataUrl) });

    let content;
    if (imagesToSend.length > 0) {
      content = [
        { type: "text", text: displayText },
        ...imagesToSend.map((i) => ({ type: "image_url", imageUrl: i.dataUrl })),
      ];
    } else {
      content = text;
    }
    history.push({ role: "user", content });
    saveCurrentConversation();

    pendingImages = [];
    renderPendingImages();
    input.value = "";
    autoresize();

    const thinkingBody = addMessage("ai", "در حال تحلیل سوال…", { thinking: true });
    setBusy(true, "در حال دریافت پاسخ…");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, fileContext: buildFileContext() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "خطای نامشخص");

      thinkingBody.classList.remove("thinking");
      thinkingBody.innerHTML = renderMarkdownLite(data.reply);
      attachCodeCopyButtons(thinkingBody);
      history.push({ role: "assistant", content: data.reply });
      saveCurrentConversation();
      chatEl.scrollTop = chatEl.scrollHeight;
    } catch (err) {
      thinkingBody.classList.remove("thinking");
      thinkingBody.innerHTML = `⚠️ خطا: ${escapeHtml(err.message)}`;
    } finally {
      setBusy(false);
    }
  }

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && pendingImages.length === 0) return;
    sendMessage(text);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  clearBtn.addEventListener("click", () => {
    history = [];
    attachedFiles = [];
    pendingImages = [];
    currentConvTitle = "چت جدید";
    resetChatUI();
    addMessage("ai", "گفتگو پاک شد. سوال جدیدتان را بپرسید.");
    saveCurrentConversation();
  });

  newChatBtn.addEventListener("click", () => startNewConversation());

  // ================= شروع برنامه =================
  (function init() {
    const savedCurrentId = localStorage.getItem(CURRENT_KEY);
    const idx = readIndex();
    if (savedCurrentId && idx.some((c) => c.id === savedCurrentId)) {
      switchToConversation(savedCurrentId);
    } else if (idx.length > 0) {
      const latest = idx.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
      switchToConversation(latest.id);
    } else {
      startNewConversation();
    }
  })();
})();