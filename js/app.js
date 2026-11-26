(() => {
  const STORAGE_KEY = "notes";
  const DEFAULT_LANGUAGE = "markdown";
  const PLAIN_TEXT = "plaintext";
  const DEFAULT_FONT_SIZE = 14;
  const MAX_HIGHLIGHT_CHARS = 200000;
  const MIN_FONT_SIZE = 8;
  const MAX_FONT_SIZE = 48;
  const SAVE_DELAY = 300;
  const IMAGE_DB_NAME = "notes-images";
  const IMAGE_STORE = "images";
  const MAX_IMAGE_SIZE = 1600;
  const IMAGE_DISPLAY_WIDTH = 400;
  const MIN_IMAGE_WIDTH = 40;
  const LINE_COMMENT = (open) => ({ open });
  const BLOCK_COMMENT = (open, close) => ({ open, close });
  const COMMENT_STYLES = {
    javascript: LINE_COMMENT("//"),
    typescript: LINE_COMMENT("//"),
    java: LINE_COMMENT("//"),
    c: LINE_COMMENT("//"),
    cpp: LINE_COMMENT("//"),
    csharp: LINE_COMMENT("//"),
    go: LINE_COMMENT("//"),
    rust: LINE_COMMENT("//"),
    swift: LINE_COMMENT("//"),
    kotlin: LINE_COMMENT("//"),
    objectivec: LINE_COMMENT("//"),
    php: LINE_COMMENT("//"),
    python: LINE_COMMENT("#"),
    "python-repl": LINE_COMMENT("#"),
    bash: LINE_COMMENT("#"),
    shell: LINE_COMMENT("#"),
    ruby: LINE_COMMENT("#"),
    perl: LINE_COMMENT("#"),
    yaml: LINE_COMMENT("#"),
    r: LINE_COMMENT("#"),
    makefile: LINE_COMMENT("#"),
    graphql: LINE_COMMENT("#"),
    ini: LINE_COMMENT(";"),
    sql: LINE_COMMENT("--"),
    lua: LINE_COMMENT("--"),
    vbnet: LINE_COMMENT("'"),
    markdown: BLOCK_COMMENT("<!--", "-->"),
    xml: BLOCK_COMMENT("<!--", "-->"),
    css: BLOCK_COMMENT("/*", "*/"),
    scss: BLOCK_COMMENT("/*", "*/"),
    less: BLOCK_COMMENT("/*", "*/"),
  };

  const noteEl = document.getElementById("note");
  const highlightEl = document.getElementById("highlight");
  const codeEl = highlightEl.querySelector("code");
  const labelEl = document.getElementById("language-label");
  const panelEl = document.getElementById("panel");
  const filterEl = document.getElementById("filter");
  const listEl = document.getElementById("list");
  const helpEl = document.getElementById("help");
  const editorEl = document.querySelector(".editor");
  const imagesEl = document.getElementById("images");
  const mirrorEl = document.createElement("div");
  mirrorEl.className = "mirror";
  editorEl.append(mirrorEl);

  const state = loadState();
  let frame = 0;
  let panelMode = null;
  let allEntries = [];
  let visible = [];
  let currentId = null;
  let listIndex = 0;
  let selectedImageId = null;
  let imageRenderId = 0;
  let imageDrag = null;
  let imageDbPromise = null;
  let saveTimer = 0;
  let cachedLanguages = null;
  let loadedId = null;
  const imageUrls = new Map();

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function createBuffer(text = "", language = DEFAULT_LANGUAGE, fontSize = DEFAULT_FONT_SIZE) {
    const now = Date.now();
    return { id: newId(), text, language, fontSize, wrap: true, images: [], created: now, updated: now };
  }

  function loadState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      saved = null;
    }

    if (!saved || !Array.isArray(saved.buffers) || !saved.buffers.length) {
      const buffer = createBuffer();
      return { buffers: [buffer], activeId: buffer.id, helpSeen: false };
    }

    const activeExists = saved.buffers.some((b) => b.id === saved.activeId);
    return {
      buffers: saved.buffers,
      activeId: activeExists ? saved.activeId : saved.buffers[0].id,
      helpSeen: saved.helpSeen === true,
    };
  }

  function saveState() {
    rememberCursor();
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage is full or unavailable; the notes stay in the page until reload.
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, SAVE_DELAY);
  }

  function currentBuffer() {
    return state.buffers.find((b) => b.id === state.activeId);
  }

  function rememberCursor() {
    const buffer = state.buffers.find((b) => b.id === loadedId);
    if (!buffer) return;
    buffer.cursor = { start: noteEl.selectionStart, end: noteEl.selectionEnd, scroll: noteEl.scrollTop };
  }

  function restoreCursor() {
    const cursor = currentBuffer().cursor ?? {};
    const length = noteEl.value.length;
    noteEl.setSelectionRange(Math.min(cursor.start ?? 0, length), Math.min(cursor.end ?? 0, length));
    noteEl.scrollTop = cursor.scroll ?? 0;
    syncScroll();
  }

  function applyFontSize() {
    document.documentElement.style.setProperty("--font-size", `${currentBuffer().fontSize}px`);
  }

  function applyWrap() {
    editorEl.classList.toggle("nowrap", currentBuffer().wrap === false);
  }

  function toggleWrap() {
    const buffer = currentBuffer();
    buffer.wrap = buffer.wrap === false;
    applyWrap();
    saveState();
    render();
  }

  function languageName(language) {
    return language === PLAIN_TEXT ? "Plain text" : language;
  }

  function cleanTitle(line) {
    return line
      .trim()
      .replace(/^(#+|\/\/+|--+|;+|%+|'|\/\*+|<!--)\s*/, "")
      .replace(/\s*(\*\/|-->)$/, "")
      .trim();
  }

  function bufferName(buffer) {
    for (const line of buffer.text.split("\n")) {
      const title = cleanTitle(line);
      if (title) return title.slice(0, 60);
    }
    return `Untitled ${state.buffers.indexOf(buffer) + 1}`;
  }

  function highlight(text, language) {
    if (language === PLAIN_TEXT || !hljs.getLanguage(language) || text.length > MAX_HIGHLIGHT_CHARS) {
      codeEl.className = "";
      codeEl.textContent = text;
      return;
    }
    const result = hljs.highlight(text, { language, ignoreIllegals: true });
    codeEl.className = `hljs language-${language}`;
    codeEl.innerHTML = result.value;
  }

  function render() {
    const text = noteEl.value;
    highlight(text, currentBuffer().language);
    if (text.endsWith("\n")) {
      codeEl.append("\n");
    }
    syncScroll();
  }

  function syncScroll() {
    highlightEl.scrollTop = noteEl.scrollTop;
    highlightEl.scrollLeft = noteEl.scrollLeft;
    syncImages();
  }

  function scheduleRender() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }

  function updateLabel() {
    labelEl.textContent = languageName(currentBuffer().language);
  }

  function loadEditor() {
    loadedId = currentBuffer().id;
    noteEl.value = currentBuffer().text;
    applyFontSize();
    applyWrap();
    updateLabel();
    deselectImage();
    renderImages();
    render();
    restoreCursor();
  }

  function switchBuffer(id) {
    if (id === state.activeId) return;
    state.activeId = id;
    saveState();
    loadEditor();
  }

  function setLanguage(language) {
    currentBuffer().language = language;
    saveState();
    updateLabel();
    render();
  }

  function newBuffer() {
    const buffer = createBuffer();
    state.buffers.push(buffer);
    state.activeId = buffer.id;
    saveState();
    loadEditor();
    noteEl.focus();
  }

  function deleteBuffer(id) {
    for (const image of state.buffers.find((b) => b.id === id)?.images ?? []) {
      removeImageBlob(image.id);
    }
    state.buffers = state.buffers.filter((b) => b.id !== id);
    if (!state.buffers.length) {
      state.buffers.push(createBuffer());
    }
    if (!state.buffers.some((b) => b.id === state.activeId)) {
      state.activeId = [...state.buffers].sort((a, b) => b.updated - a.updated)[0].id;
      loadEditor();
    }
    saveState();
  }

  function deleteHighlighted() {
    const entry = visible[listIndex];
    if (!entry || !confirm(`Delete "${entry.label}"?`)) return;
    deleteBuffer(entry.id);
    allEntries = bufferEntries();
    currentId = state.activeId;
    renderList();
  }

  function toggleHelp() {
    if (helpEl.hidden) {
      panelMode = null;
      panelEl.hidden = true;
      helpEl.hidden = false;
      helpEl.focus();
    } else {
      helpEl.hidden = true;
      state.helpSeen = true;
      saveState();
      noteEl.focus();
    }
  }

  function openImageDb() {
    if (!imageDbPromise) {
      imageDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(IMAGE_DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(IMAGE_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return imageDbPromise;
  }

  async function imageRequest(mode, action) {
    const db = await openImageDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE, mode);
      const request = action(transaction.objectStore(IMAGE_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function putImageBlob(id, blob) {
    return imageRequest("readwrite", (store) => store.put(blob, id));
  }

  function removeImageBlob(id) {
    const url = imageUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      imageUrls.delete(id);
    }
    return imageRequest("readwrite", (store) => store.delete(id)).catch(() => {});
  }

  async function imageUrl(id) {
    if (!imageUrls.has(id)) {
      const blob = await imageRequest("readonly", (store) => store.get(id));
      if (!blob) return null;
      imageUrls.set(id, URL.createObjectURL(blob));
    }
    return imageUrls.get(id);
  }

  function imagesOf(buffer) {
    buffer.images ??= [];
    return buffer.images;
  }

  async function shrinkImage(blob) {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(width, height));
    if (scale === 1) {
      bitmap.close();
      return { blob, width, height };
    }

    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const resized = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!resized) return { blob, width, height };
    return { blob: resized, width: targetWidth, height: targetHeight };
  }

  function caretPosition() {
    mirrorEl.style.width = `${noteEl.clientWidth}px`;
    mirrorEl.textContent = noteEl.value.slice(0, noteEl.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirrorEl.append(marker);
    return { x: marker.offsetLeft, y: marker.offsetTop };
  }

  async function addImage(blob, buffer, position) {
    const { blob: stored, width, height } = await shrinkImage(blob);
    const id = newId();
    await putImageBlob(id, stored);
    const displayWidth = Math.min(width, IMAGE_DISPLAY_WIDTH);
    imagesOf(buffer).push({
      id,
      x: position.x,
      y: position.y,
      w: displayWidth,
      h: Math.round((displayWidth * height) / width),
    });
    buffer.updated = Date.now();
    saveState();
    if (buffer === currentBuffer()) renderImages();
  }

  function syncImages() {
    imagesEl.style.transform = `translate(${-noteEl.scrollLeft}px, ${-noteEl.scrollTop}px)`;
  }

  function applyBox(el, box) {
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
  }

  function createFloating(image) {
    const el = document.createElement("div");
    el.className = "floating";
    el.dataset.id = image.id;
    applyBox(el, image);
    if (image.id === selectedImageId) el.classList.add("selected");

    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    const handle = document.createElement("span");
    handle.className = "handle";
    el.append(img, handle);

    el.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey) return;
        event.preventDefault();
        noteEl.scrollBy(event.deltaX, event.deltaY);
      },
      { passive: false }
    );
    return el;
  }

  function renderImages() {
    const token = ++imageRenderId;
    imagesEl.replaceChildren();
    for (const image of imagesOf(currentBuffer())) {
      const el = createFloating(image);
      imagesEl.append(el);
      imageUrl(image.id)
        .then((url) => {
          if (url && token === imageRenderId) el.querySelector("img").src = url;
        })
        .catch(() => {});
    }
    syncImages();
  }

  function selectImage(id) {
    selectedImageId = id;
    for (const el of imagesEl.children) {
      el.classList.toggle("selected", el.dataset.id === id);
    }
  }

  function deselectImage() {
    selectedImageId = null;
    for (const el of imagesEl.children) {
      el.classList.remove("selected");
    }
  }

  function deleteImage(id) {
    const buffer = currentBuffer();
    buffer.images = imagesOf(buffer).filter((image) => image.id !== id);
    removeImageBlob(id);
    selectedImageId = null;
    buffer.updated = Date.now();
    saveState();
    renderImages();
  }

  imagesEl.addEventListener("pointerdown", (event) => {
    const el = event.target.closest(".floating");
    if (!el || event.button !== 0) return;
    event.preventDefault();
    noteEl.focus();
    selectImage(el.dataset.id);
    const image = imagesOf(currentBuffer()).find((i) => i.id === el.dataset.id);
    if (!image) return;
    imageDrag = {
      el,
      image,
      resize: event.target.classList.contains("handle"),
      startX: event.clientX,
      startY: event.clientY,
      start: { x: image.x, y: image.y, w: image.w, h: image.h },
      current: { x: image.x, y: image.y, w: image.w, h: image.h },
    };
    el.setPointerCapture(event.pointerId);
  });

  imagesEl.addEventListener("pointermove", (event) => {
    if (!imageDrag) return;
    const { start, current, resize, image } = imageDrag;
    const dx = event.clientX - imageDrag.startX;
    const dy = event.clientY - imageDrag.startY;
    if (resize) {
      current.w = Math.max(MIN_IMAGE_WIDTH, start.w + dx);
      current.h = Math.round((current.w * image.h) / image.w);
    } else {
      current.x = Math.max(0, start.x + dx);
      current.y = Math.max(0, start.y + dy);
    }
    applyBox(imageDrag.el, current);
  });

  function endImageDrag() {
    if (!imageDrag) return;
    const { image, current } = imageDrag;
    const changed = ["x", "y", "w", "h"].some((key) => image[key] !== current[key]);
    if (changed) {
      Object.assign(image, current);
      currentBuffer().updated = Date.now();
      saveState();
    }
    imageDrag = null;
  }

  imagesEl.addEventListener("pointerup", endImageDrag);
  imagesEl.addEventListener("pointercancel", endImageDrag);

  noteEl.addEventListener("paste", (event) => {
    const item = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    event.preventDefault();
    const blob = item.getAsFile();
    if (!blob) return;
    addImage(blob, currentBuffer(), caretPosition()).catch(() => {});
  });

  noteEl.addEventListener("pointerdown", () => {
    deselectImage();
  });

  function bufferEntries() {
    return [...state.buffers]
      .sort((a, b) => b.updated - a.updated)
      .map((buffer) => ({
        id: buffer.id,
        label: bufferName(buffer),
        meta: languageName(buffer.language),
      }));
  }

  function languageEntries() {
    cachedLanguages ??= [PLAIN_TEXT, ...hljs.listLanguages().filter((name) => name !== PLAIN_TEXT).sort()].map(
      (name) => ({ id: name, label: languageName(name) })
    );
    return cachedLanguages;
  }

  function highlightSelection() {
    const items = listEl.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("selected", i === listIndex);
    }
    items[listIndex]?.scrollIntoView({ block: "nearest" });
  }

  function renderList() {
    const query = filterEl.value.trim().toLowerCase();
    visible = allEntries.filter((entry) => entry.label.toLowerCase().includes(query));
    const currentIndex = visible.findIndex((entry) => entry.id === currentId);
    listIndex = query ? 0 : Math.max(0, currentIndex);

    const items = visible.map((entry, index) => {
      const item = document.createElement("li");
      item.dataset.index = index;
      if (entry.id === currentId) item.classList.add("current");

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = entry.label;
      item.append(name);

      if (entry.meta) {
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = entry.meta;
        item.append(meta);
      }
      return item;
    });
    listEl.replaceChildren(...items);
    highlightSelection();
  }

  function openPanel(mode) {
    panelMode = mode;
    allEntries = mode === "buffers" ? bufferEntries() : languageEntries();
    currentId = mode === "buffers" ? state.activeId : currentBuffer().language;
    filterEl.value = "";
    renderList();
    panelEl.hidden = false;
    filterEl.focus();
  }

  function closePanel() {
    panelMode = null;
    panelEl.hidden = true;
    noteEl.focus();
  }

  function togglePanel(mode) {
    if (panelMode === mode) {
      closePanel();
    } else {
      openPanel(mode);
    }
  }

  filterEl.addEventListener("input", renderList);

  function chooseEntry(index) {
    const entry = visible[index];
    if (!entry) return;
    if (panelMode === "buffers") {
      switchBuffer(entry.id);
    } else {
      setLanguage(entry.id);
    }
    closePanel();
  }

  noteEl.addEventListener("input", () => {
    const buffer = currentBuffer();
    buffer.text = noteEl.value;
    buffer.updated = Date.now();
    scheduleSave();
    scheduleRender();
  });

  window.addEventListener("pagehide", saveState);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveState();
  });

  noteEl.addEventListener("scroll", syncScroll);

  editorEl.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const buffer = currentBuffer();
      const next = buffer.fontSize - Math.sign(event.deltaY);
      buffer.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
      applyFontSize();
      saveState();
      render();
    },
    { passive: false }
  );

  function scrollCaretIntoView() {
    const { y } = caretPosition();
    const style = getComputedStyle(noteEl);
    const lineHeight = parseFloat(style.lineHeight) || 0;
    const padding = parseFloat(style.paddingBottom) || 0;
    const top = noteEl.scrollTop;
    const bottom = top + noteEl.clientHeight - padding;
    if (y < top) {
      noteEl.scrollTop = y;
    } else if (y + lineHeight > bottom) {
      noteEl.scrollTop = y + lineHeight - noteEl.clientHeight + padding;
    }
    syncScroll();
  }

  function replaceRange(from, to, text, selStart, selEnd) {
    noteEl.setSelectionRange(from, to);
    if (!document.execCommand("insertText", false, text)) {
      const value = noteEl.value;
      noteEl.value = value.slice(0, from) + text + value.slice(to);
      noteEl.dispatchEvent(new Event("input"));
    }
    noteEl.setSelectionRange(selStart, selEnd);
    scrollCaretIntoView();
  }

  function insertText(text, caretOffset = text.length) {
    const caret = noteEl.selectionStart + caretOffset;
    replaceRange(noteEl.selectionStart, noteEl.selectionEnd, text, caret, caret);
  }

  function insertNewline() {
    const { selectionStart: start, selectionEnd: end, value } = noteEl;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const base = value.slice(lineStart, start).match(/^[ \t]*/)[0];
    const before = value[start - 1];
    const after = value[end];
    const opens = "{([";
    const closes = "})]";
    const opened = opens.includes(before);
    const indent = opened ? base + "    " : base;

    if (opened && closes[opens.indexOf(before)] === after) {
      insertText("\n" + indent + "\n" + base, 1 + indent.length);
    } else {
      insertText("\n" + indent);
    }
  }

  function lineStartAt(pos) {
    return pos <= 0 ? 0 : noteEl.value.lastIndexOf("\n", pos - 1) + 1;
  }

  function selectedBlock() {
    const { selectionStart: start, selectionEnd: end, value } = noteEl;
    const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
    const blockStart = lineStartAt(start);
    const newlineAfter = value.indexOf("\n", effectiveEnd);
    const blockEnd = newlineAfter === -1 ? value.length : newlineAfter;
    return { start, end, value, blockStart, blockEnd };
  }

  function moveLines(direction) {
    const { start, end, value, blockStart, blockEnd } = selectedBlock();
    const block = value.slice(blockStart, blockEnd);

    if (direction < 0) {
      if (blockStart === 0) return;
      const prevStart = lineStartAt(blockStart - 1);
      const prevLine = value.slice(prevStart, blockStart - 1);
      const delta = -(prevLine.length + 1);
      replaceRange(prevStart, blockEnd, block + "\n" + prevLine, start + delta, end + delta);
    } else {
      if (blockEnd >= value.length) return;
      const nextEnd = value.indexOf("\n", blockEnd + 1);
      const lineEnd = nextEnd === -1 ? value.length : nextEnd;
      const nextLine = value.slice(blockEnd + 1, lineEnd);
      const delta = nextLine.length + 1;
      replaceRange(blockStart, lineEnd, nextLine + "\n" + block, start + delta, end + delta);
    }
  }

  function indentLines(outdent) {
    const { start, end, value, blockStart, blockEnd } = selectedBlock();
    const lines = value.slice(blockStart, blockEnd).split("\n");

    const changed = lines.map((line) => (outdent ? line.replace(/^( {1,4}|\t)/, "") : "    " + line));
    const removed = lines.map((line, i) => line.length - changed[i].length);
    const totalDelta = outdent ? -removed.reduce((sum, n) => sum + n, 0) : lines.length * 4;
    const firstDelta = outdent ? -removed[0] : 4;

    replaceRange(
      blockStart,
      blockEnd,
      changed.join("\n"),
      Math.max(blockStart, start + firstDelta),
      end + totalDelta
    );
  }

  function commentLines() {
    const style = COMMENT_STYLES[currentBuffer().language];
    if (!style) return;
    const { start, end, value, blockStart, blockEnd } = selectedBlock();
    const lines = value.slice(blockStart, blockEnd).split("\n");
    const filled = lines.filter((line) => line.trim());
    if (!filled.length) return;

    const { open, close } = style;
    const isCommented = (line) =>
      line.trimStart().startsWith(open) && (!close || line.trimEnd().endsWith(close));

    let changed;
    if (filled.every(isCommented)) {
      changed = lines.map((line) => {
        if (!line.trim()) return line;
        const body = line.trimEnd();
        const indent = body.match(/^\s*/)[0];
        let rest = body.slice(indent.length + open.length);
        if (rest.startsWith(" ")) rest = rest.slice(1);
        if (close && rest.endsWith(close)) {
          rest = rest.slice(0, -close.length);
          if (rest.endsWith(" ")) rest = rest.slice(0, -1);
        }
        return indent + rest;
      });
    } else {
      const column = Math.min(...filled.map((line) => line.match(/^\s*/)[0].length));
      changed = lines.map((line) => {
        if (!line.trim()) return line;
        return line.slice(0, column) + open + " " + line.slice(column) + (close ? " " + close : "");
      });
    }

    const deltas = lines.map((line, i) => changed[i].length - line.length);
    const totalDelta = deltas.reduce((sum, n) => sum + n, 0);
    replaceRange(
      blockStart,
      blockEnd,
      changed.join("\n"),
      Math.max(blockStart, start + deltas[0]),
      end + totalDelta
    );
  }

  let freshBufferKey = false;

  document.addEventListener("keyup", (event) => {
    if (event.code !== "KeyN" || !freshBufferKey) return;
    freshBufferKey = false;
    const cleaned = noteEl.value.replace(/^[~˜]+/, "");
    if (cleaned !== noteEl.value) {
      noteEl.value = cleaned;
      noteEl.dispatchEvent(new Event("input"));
    }
  });


  noteEl.addEventListener("keydown", (event) => {
    if (selectedImageId) {
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteImage(selectedImageId);
        return;
      }
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
        deselectImage();
      }
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        moveLines(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
    }
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === "Slash") {
      event.preventDefault();
      commentLines();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      insertNewline();
    } else if (event.key === "Tab") {
      event.preventDefault();
      const collapsed = noteEl.selectionStart === noteEl.selectionEnd;
      if (!event.shiftKey && collapsed) {
        insertText("    ");
      } else {
        indentLines(event.shiftKey);
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.code === "Slash") {
      event.preventDefault();
      toggleHelp();
      return;
    }
    if (!helpEl.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        toggleHelp();
      }
      return;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.code === "KeyZ") {
        event.preventDefault();
        toggleWrap();
        return;
      }
      if (event.code === "KeyN") {
        event.preventDefault();
        panelMode = null;
        panelEl.hidden = true;
        freshBufferKey = true;
        newBuffer();
        return;
      }
      if (event.code === "KeyB") {
        event.preventDefault();
        togglePanel("buffers");
        return;
      }
      if (event.code === "KeyL") {
        event.preventDefault();
        togglePanel("languages");
        return;
      }
    }

    if (!panelMode) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      listIndex = Math.min(visible.length - 1, listIndex + 1);
      highlightSelection();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      listIndex = Math.max(0, listIndex - 1);
      highlightSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseEntry(listIndex);
    } else if (
      (event.key === "Delete" || (event.key === "Backspace" && event.shiftKey)) &&
      panelMode === "buffers" &&
      filterEl.selectionStart === filterEl.value.length
    ) {
      event.preventDefault();
      deleteHighlighted();
    }
  });

  if (/Macintosh|Mac OS X|iPhone|iPad/.test(navigator.userAgent)) {
    for (const term of helpEl.querySelectorAll("dt")) {
      term.textContent = term.textContent.replace(/\bAlt\b/g, "Option");
    }
  }

  helpEl.addEventListener("click", (event) => {
    if (event.target === helpEl) toggleHelp();
  });

  listEl.addEventListener("click", (event) => {
    const item = event.target.closest("li");
    if (!item) return;
    chooseEntry(Number(item.dataset.index));
  });

  panelEl.addEventListener("click", (event) => {
    if (event.target === panelEl) closePanel();
  });

  loadEditor();
  noteEl.focus();
  if (!state.helpSeen) {
    toggleHelp();
  }
})();
