let lastSelection = "";
let lastSelectionRect = null;
let translateButton = null;
let bubble = null;
let bubbleText = null;
let bubbleActions = null;
let bubbleOptionsButton = null;
let activeRequestId = 0;
let isPointerSelecting = false;
let lastPointerPosition = null;
let hiddenSelectionText = "";
let lastSelectionAnchor = null;
let showInlineButton = true;
let bubbleFont = "system";
let pageTranslationSessionId = 0;
let pageTranslationOriginalTexts = new WeakMap();
let pageTranslationOriginalNodes = [];
let pageTranslationStatus = null;
let pageTranslationStatusText = null;
let pageTranslationMoreButton = null;
let pageTranslationRestoreButton = null;
let pageTranslationOptionsButton = null;

const PAGE_TRANSLATION_MAX_NODES = 220;
const PAGE_TRANSLATION_MAX_CHARS = 10000;
const PAGE_TRANSLATION_BATCH_SIZE = 30;
const PAGE_TRANSLATION_VIEWPORT_MARGIN = 4;
const PAGE_TRANSLATION_SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "CODE",
  "PRE",
  "SVG",
  "CANVAS"
]);
const BUBBLE_FONT_FAMILIES = {
  system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  sans: "Arial, 'Noto Sans KR', 'Malgun Gothic', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
};

loadContentSettings();
document.addEventListener("selectionchange", handleSelectionChange);
document.addEventListener("mousedown", handleDocumentMouseDown, true);
document.addEventListener("mouseup", handlePointerSelectionEnd, true);
document.addEventListener("keyup", handleKeyboardSelectionEnd, true);
window.addEventListener("scroll", hideTranslateButton, true);
window.addEventListener("resize", repositionFloatingUi);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  if (changes.showInlineButton) {
    showInlineButton = changes.showInlineButton.newValue !== false;
    if (!showInlineButton) {
      hideTranslateButton();
    }
  }

  if (changes.bubbleFont) {
    bubbleFont = changes.bubbleFont.newValue || "system";
    applyBubbleFont();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SELECTED_TEXT") {
    const selectedText = window.getSelection()?.toString().trim() || lastSelection;
    sendResponse({ text: selectedText });
    return true;
  }

  if (message?.type === "SHOW_TRANSLATOR_POPUP") {
    captureSelectionState();

    const selectedText = window.getSelection()?.toString().trim() || lastSelection;
    if (!selectedText) {
      showBubbleAtCurrentSelection("번역할 문장을 먼저 선택하세요.", true);
      return false;
    }

    requestTranslation(selectedText);
  }

  if (message?.type === "TRANSLATE_PAGE") {
    translatePageToKorean()
      .catch((error) => {
        showPageTranslationStatus(
          error.message || "화면 번역 중 오류가 발생했습니다.",
          true,
          hasPageTranslationOriginals(),
          isMissingApiKeyError(error)
        );
      });

    sendResponse({ ok: true, started: true });
    return false;
  }

  if (message?.type === "RESTORE_PAGE_TRANSLATION") {
    const result = restorePageTranslation();
    sendResponse({ ok: true, ...result });
    return true;
  }

  return false;
});

function handleSelectionChange() {
  if (!showInlineButton) {
    captureSelectionState();
    hideTranslateButton();
    return;
  }

  if (isPointerSelecting) {
    hideTranslateButton();
    return;
  }

  updateSelectionUi();
}

function handlePointerSelectionEnd(event) {
  isPointerSelecting = false;
  lastPointerPosition = {
    x: event.clientX,
    y: event.clientY
  };

  if (!showInlineButton) {
    captureSelectionState();
    hideTranslateButton();
    return;
  }

  updateSelectionUi();
}

function handleKeyboardSelectionEnd(event) {
  if (!showInlineButton) {
    captureSelectionState();
    hideTranslateButton();
    return;
  }

  if (event.key.startsWith("Arrow") || event.key === "Shift") {
    updateSelectionUi();
  }
}

function updateSelectionUi() {
  window.setTimeout(() => {
    if (!showInlineButton) {
      captureSelectionState();
      hideTranslateButton();
      return;
    }

    const selectionState = captureSelectionState();
    if (!selectionState) {
      hideTranslateButton();
      return;
    }

    if (selectionState.text === hiddenSelectionText) {
      hideTranslateButton();
      return;
    }

    renderTranslateButton(selectionState.rect, lastPointerPosition);
  }, 0);
}

function handleDocumentMouseDown(event) {
  isPointerSelecting = true;

  if (translateButton?.contains(event.target) || bubble?.contains(event.target)) {
    isPointerSelecting = false;
    return;
  }

  hideTranslateButton();
  removeBubble();
  hiddenSelectionText = "";
}

async function loadContentSettings() {
  const settings = await chrome.storage.sync.get({
    showInlineButton: true,
    bubbleFont: "system"
  });
  showInlineButton = settings.showInlineButton !== false;
  bubbleFont = settings.bubbleFont || "system";
  if (!showInlineButton) {
    hideTranslateButton();
  }
}

function captureSelectionState() {
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() || "";

  if (!selectedText || !selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = getRangeRect(range);
  if (!rect) {
    return null;
  }

  lastSelection = selectedText;
  lastSelectionRect = rect;
  lastSelectionAnchor = {
    left: window.scrollX + rect.left,
    top: window.scrollY + rect.top,
    bottom: window.scrollY + rect.bottom,
    viewportTop: rect.top,
    viewportBottom: rect.bottom,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  };

  return {
    text: selectedText,
    rect
  };
}

function renderTranslateButton(rect, pointerPosition) {
  if (!translateButton) {
    translateButton = document.createElement("button");
    translateButton.type = "button";
    translateButton.setAttribute("aria-label", "선택 문장 번역");
    translateButton.dataset.aiKoreanTranslatorUi = "true";
    translateButton.textContent = "번역";
    Object.assign(translateButton.style, {
      position: "absolute",
      zIndex: "2147483647",
      padding: "6px 10px",
      border: "0",
      borderRadius: "999px",
      background: "linear-gradient(180deg, #d56640, #bc4c2a)",
      color: "#fffaf5",
      fontSize: "14px",
      fontWeight: "700",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 10px 24px rgba(61, 37, 21, 0.2)",
      cursor: "pointer"
    });

    translateButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    translateButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const selectedText = window.getSelection()?.toString().trim() || lastSelection;
      if (!selectedText) {
        showBubbleAtCurrentSelection("번역할 문장을 먼저 선택하세요.", true);
        return;
      }

      lastSelection = selectedText;
      hiddenSelectionText = selectedText;
      hideTranslateButton();
      requestTranslation(selectedText);
    });

    document.body.appendChild(translateButton);
  }

  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const buttonWidth = 56;
  const buttonHeight = 34;
  const fallbackTop = rect.bottom + 8;
  const fallbackLeft = rect.left;
  const anchorTop = pointerPosition ? pointerPosition.y + 12 : fallbackTop;
  const anchorLeft = pointerPosition ? pointerPosition.x - (buttonWidth / 2) : fallbackLeft;
  const top = window.scrollY + Math.min(anchorTop, viewportHeight - buttonHeight - 12);
  const left = window.scrollX + Math.max(12, Math.min(anchorLeft, viewportWidth - buttonWidth - 12));

  translateButton.style.top = `${top}px`;
  translateButton.style.left = `${left}px`;
  translateButton.style.display = "block";
}

async function requestTranslation(text) {
  const requestId = ++activeRequestId;
  showBubbleAtCurrentSelection("번역 중...", false, true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      text
    });

    if (requestId !== activeRequestId) {
      return;
    }

    if (!response?.ok) {
      throw new Error(response?.error || "알 수 없는 오류");
    }

    showBubbleAtCurrentSelection(response.result, false);
  } catch (error) {
    if (requestId !== activeRequestId) {
      return;
    }

    showBubbleAtCurrentSelection(
      error.message || "번역 중 오류가 발생했습니다.",
      true,
      false,
      isMissingApiKeyError(error)
    );
  }
}

async function translatePageToKorean() {
  const requestId = ++pageTranslationSessionId;
  hideTranslateButton();
  removeBubble();

  const { entries, truncated } = collectPageTextEntries();
  if (!entries.length) {
    throw new Error("현재 화면에서 번역할 텍스트를 찾지 못했습니다.");
  }

  showPageTranslationStatus(`보이는 부분 번역 중... 0/${entries.length}`, false, false);

  let translatedCount = 0;
  for (let index = 0; index < entries.length; index += PAGE_TRANSLATION_BATCH_SIZE) {
    if (requestId !== pageTranslationSessionId) {
      return { count: translatedCount, truncated, cancelled: true };
    }

    const batch = entries.slice(index, index + PAGE_TRANSLATION_BATCH_SIZE);
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT_BATCH",
      items: batch.map((entry) => ({
        id: entry.id,
        text: entry.text
      }))
    });

    if (!response?.ok) {
      throw new Error(response?.error || "화면 번역 중 오류가 발생했습니다.");
    }

    if (requestId !== pageTranslationSessionId) {
      return { count: translatedCount, truncated, cancelled: true };
    }

    const results = Array.isArray(response.results) ? response.results : [];
    const translationsById = makeTranslationsById(results, batch);

    batch.forEach((entry) => {
      if (applyPageTranslation(entry, translationsById.get(entry.id))) {
        translatedCount += 1;
      }
    });

    showPageTranslationStatus(`보이는 부분 번역 중... ${translatedCount}/${entries.length}`, false, false);
  }

  const statusMessage = truncated
    ? `보이는 부분 일부 번역 완료 (${translatedCount}개). 텍스트가 많아 일부만 번역했습니다.`
    : `보이는 부분 번역 완료 (${translatedCount}개).`;
  showPageTranslationStatus(statusMessage, false, true);

  return { count: translatedCount, truncated };
}

function collectPageTextEntries() {
  const entries = [];
  let totalChars = 0;
  let truncated = false;

  if (!document.body) {
    return { entries, truncated };
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: acceptPageTextNode
  });

  let node = walker.nextNode();
  while (node) {
    const text = normalizePageText(node.nodeValue);
    if (text && shouldTranslatePageText(text)) {
      if (entries.length >= PAGE_TRANSLATION_MAX_NODES || totalChars + text.length > PAGE_TRANSLATION_MAX_CHARS) {
        truncated = true;
        break;
      }

      entries.push({
        id: `visible-${entries.length}`,
        node,
        text
      });
      totalChars += text.length;
    }

    node = walker.nextNode();
  }

  return { entries, truncated };
}

function acceptPageTextNode(node) {
  const parent = node.parentElement;
  if (!parent) {
    return NodeFilter.FILTER_REJECT;
  }

  if (pageTranslationOriginalTexts.has(node)) {
    return NodeFilter.FILTER_REJECT;
  }

  if (PAGE_TRANSLATION_SKIP_TAGS.has(parent.tagName)) {
    return NodeFilter.FILTER_REJECT;
  }

  if (parent.closest("[data-ai-korean-translator-ui='true']")) {
    return NodeFilter.FILTER_REJECT;
  }

  if (parent.isContentEditable || parent.closest("[contenteditable='true']")) {
    return NodeFilter.FILTER_REJECT;
  }

  if (!isVisiblePageTextParent(parent)) {
    return NodeFilter.FILTER_REJECT;
  }

  if (!isTextNodeInViewport(node)) {
    return NodeFilter.FILTER_REJECT;
  }

  return NodeFilter.FILTER_ACCEPT;
}

function normalizePageText(text) {
  return `${text || ""}`.replace(/\s+/g, " ").trim();
}

function shouldTranslatePageText(text) {
  if (text.length < 2) {
    return false;
  }

  if (/^[\d\s.,:;!?()[\]{}'"`~@#$%^&*_+=|\\/<>-]+$/.test(text)) {
    return false;
  }

  if (/[가-힣]/.test(text) && !/[A-Za-z\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff]/.test(text)) {
    return false;
  }

  return /[A-Za-z\u00c0-\u024f\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function isVisiblePageTextParent(element) {
  if (!element.isConnected) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }

  return element.getClientRects().length > 0;
}

function isTextNodeInViewport(node) {
  const range = document.createRange();

  try {
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;

    for (const rect of rects) {
      const hasArea = rect.width > 0 || rect.height > 0;
      const intersectsViewport =
        rect.bottom >= -PAGE_TRANSLATION_VIEWPORT_MARGIN &&
        rect.right >= -PAGE_TRANSLATION_VIEWPORT_MARGIN &&
        rect.top <= viewportHeight + PAGE_TRANSLATION_VIEWPORT_MARGIN &&
        rect.left <= viewportWidth + PAGE_TRANSLATION_VIEWPORT_MARGIN;

      if (hasArea && intersectsViewport) {
        return true;
      }
    }
  } finally {
    range.detach?.();
  }

  return false;
}

function applyPageTranslation(entry, translatedText) {
  if (!entry?.node?.isConnected || !translatedText) {
    return false;
  }

  const currentText = entry.node.nodeValue || "";
  if (!pageTranslationOriginalTexts.has(entry.node)) {
    pageTranslationOriginalTexts.set(entry.node, currentText);
    pageTranslationOriginalNodes.push(entry.node);
  }

  entry.node.nodeValue = preserveOuterWhitespace(currentText, translatedText);
  return true;
}

function makeTranslationsById(results, batch) {
  const translationsById = new Map();
  const expectedIds = new Set(batch.map((entry) => entry.id));

  results.forEach((result) => {
    const id = `${result?.id || ""}`.trim();
    const translation = `${result?.translation || ""}`.trim();

    if (!id || !expectedIds.has(id)) {
      return;
    }

    if (translationsById.has(id)) {
      throw new Error("화면 번역 결과 ID가 중복되었습니다.");
    }

    if (!translation) {
      throw new Error("화면 번역 결과를 읽지 못했습니다.");
    }

    translationsById.set(id, translation);
  });

  const missingEntry = batch.find((entry) => !translationsById.has(entry.id));
  if (missingEntry) {
    throw new Error("화면 번역 결과 ID가 원문과 맞지 않습니다.");
  }

  return translationsById;
}

function preserveOuterWhitespace(originalText, translatedText) {
  const leadingWhitespace = originalText.match(/^\s*/)?.[0] || "";
  const trailingWhitespace = originalText.match(/\s*$/)?.[0] || "";
  return `${leadingWhitespace}${`${translatedText || ""}`.trim()}${trailingWhitespace}`;
}

function restorePageTranslation() {
  pageTranslationSessionId += 1;

  let restoredCount = 0;
  pageTranslationOriginalNodes.forEach((node) => {
    if (!node.isConnected || !pageTranslationOriginalTexts.has(node)) {
      return;
    }

    node.nodeValue = pageTranslationOriginalTexts.get(node);
    restoredCount += 1;
  });

  pageTranslationOriginalTexts = new WeakMap();
  pageTranslationOriginalNodes = [];
  showPageTranslationStatus(`원문으로 복원했습니다 (${restoredCount}개).`, false, false);
  return { count: restoredCount };
}

function showPageTranslationStatus(message, isError, showRestore, showOptions = false) {
  if (!pageTranslationStatus) {
    pageTranslationStatus = document.createElement("div");
    pageTranslationStatus.dataset.aiKoreanTranslatorUi = "true";
    Object.assign(pageTranslationStatus.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "2147483647",
      width: "min(360px, calc(100vw - 32px))",
      padding: "12px",
      borderRadius: "8px",
      border: "1px solid rgba(103, 80, 55, 0.24)",
      background: "rgba(255, 251, 245, 0.97)",
      color: "#261a12",
      fontSize: "14px",
      lineHeight: "1.45",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 16px 36px rgba(61, 37, 21, 0.18)"
    });

    pageTranslationStatusText = document.createElement("div");

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      gap: "8px",
      marginTop: "10px"
    });

    pageTranslationMoreButton = document.createElement("button");
    pageTranslationMoreButton.type = "button";
    pageTranslationMoreButton.textContent = "추가 번역";
    stylePageTranslationAction(pageTranslationMoreButton);
    pageTranslationMoreButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      translatePageToKorean().catch((error) => {
        showPageTranslationStatus(
          error.message || "화면 번역 중 오류가 발생했습니다.",
          true,
          hasPageTranslationOriginals(),
          isMissingApiKeyError(error)
        );
      });
    });

    pageTranslationOptionsButton = document.createElement("button");
    pageTranslationOptionsButton.type = "button";
    pageTranslationOptionsButton.textContent = "설정";
    stylePageTranslationAction(pageTranslationOptionsButton);
    pageTranslationOptionsButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openOptionsPage();
    });

    pageTranslationRestoreButton = document.createElement("button");
    pageTranslationRestoreButton.type = "button";
    pageTranslationRestoreButton.textContent = "원문 복원";
    stylePageTranslationAction(pageTranslationRestoreButton);
    pageTranslationRestoreButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      restorePageTranslation();
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "닫기";
    stylePageTranslationAction(closeButton);
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hidePageTranslationStatus();
    });

    actions.append(pageTranslationMoreButton, pageTranslationOptionsButton, pageTranslationRestoreButton, closeButton);
    pageTranslationStatus.append(pageTranslationStatusText, actions);
    document.body.appendChild(pageTranslationStatus);
  }

  pageTranslationStatusText.textContent = message;
  pageTranslationStatus.style.display = "block";
  pageTranslationStatus.style.color = isError ? "#9f1239" : "#261a12";
  pageTranslationStatus.style.borderColor = isError ? "rgba(159, 18, 57, 0.38)" : "rgba(103, 80, 55, 0.24)";
  setPageTranslationActionState(showRestore, showOptions);
}

function setPageTranslationActionState(showActions, showOptions) {
  if (!pageTranslationMoreButton || !pageTranslationRestoreButton || !pageTranslationOptionsButton) {
    return;
  }

  const display = showActions ? "inline-flex" : "none";
  pageTranslationMoreButton.style.display = display;
  pageTranslationRestoreButton.style.display = showActions && hasPageTranslationOriginals() ? "inline-flex" : "none";
  pageTranslationOptionsButton.style.display = showOptions ? "inline-flex" : "none";
  pageTranslationMoreButton.disabled = !showActions;
  pageTranslationRestoreButton.disabled = !showActions;
  pageTranslationOptionsButton.disabled = !showOptions;
}

function stylePageTranslationAction(button) {
  Object.assign(button.style, {
    border: "1px solid rgba(103, 80, 55, 0.2)",
    borderRadius: "8px",
    padding: "6px 10px",
    background: "rgba(255, 255, 255, 0.72)",
    color: "#261a12",
    fontSize: "13px",
    fontWeight: "700",
    fontFamily: "system-ui, sans-serif",
    cursor: "pointer",
    alignItems: "center"
  });
}

function hidePageTranslationStatus() {
  if (pageTranslationStatus) {
    pageTranslationStatus.style.display = "none";
  }
}

function hasPageTranslationOriginals() {
  return pageTranslationOriginalNodes.some((node) => node.isConnected);
}

function isMissingApiKeyError(error) {
  return `${error?.message || error || ""}`.includes("API 키");
}

function openOptionsPage() {
  chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" }).catch(() => {});
}

function showBubbleAtCurrentSelection(message, isError, isLoading = false, showOptions = false) {
  if (!lastSelectionRect || !lastSelectionAnchor) {
    return;
  }

  if (!bubble) {
    bubble = document.createElement("div");
    bubble.dataset.aiKoreanTranslatorUi = "true";
    Object.assign(bubble.style, {
      position: "absolute",
      zIndex: "2147483647",
      width: "min(720px, calc(100vw - 24px))",
      minWidth: "min(440px, calc(100vw - 24px))",
      padding: "14px 16px",
      borderRadius: "16px",
      border: "1px solid rgba(103, 80, 55, 0.18)",
      background: "rgba(255, 251, 245, 0.96)",
      color: "#261a12",
      fontSize: "17px",
      lineHeight: "1.5",
      fontFamily: getBubbleFontFamily(),
      boxShadow: "0 18px 45px rgba(61, 37, 21, 0.16)",
      whiteSpace: "pre-wrap"
    });

    bubbleText = document.createElement("div");
    bubbleActions = document.createElement("div");

    bubbleOptionsButton = document.createElement("button");
    bubbleOptionsButton.type = "button";
    bubbleOptionsButton.textContent = "설정";
    styleBubbleAction(bubbleOptionsButton);
    bubbleOptionsButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openOptionsPage();
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "복사";
    styleBubbleAction(copyButton);
    copyButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await copyBubbleText(copyButton);
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "닫기";
    styleBubbleAction(closeButton);
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeBubble();
    });

    Object.assign(bubbleActions.style, {
      display: "flex",
      justifyContent: "flex-end",
      flexWrap: "wrap",
      gap: "8px",
      marginTop: "12px"
    });

    bubbleActions.append(bubbleOptionsButton, copyButton, closeButton);
    bubble.append(bubbleText, bubbleActions);
    document.body.appendChild(bubble);
  }

  bubbleText.textContent = message;
  bubble.dataset.error = isError ? "true" : "false";
  bubble.style.color = isError ? "#9f1239" : "#261a12";
  bubble.style.opacity = isLoading ? "0.82" : "1";
  bubbleActions.style.display = isLoading ? "none" : "flex";
  bubbleOptionsButton.style.display = showOptions ? "inline-flex" : "none";
  bubbleOptionsButton.disabled = !showOptions;
  bubble.style.display = "block";

  positionBubble(lastSelectionRect, lastSelectionAnchor);
}

function applyBubbleFont() {
  if (bubble) {
    bubble.style.fontFamily = getBubbleFontFamily();
  }
}

function getBubbleFontFamily() {
  return BUBBLE_FONT_FAMILIES[bubbleFont] || BUBBLE_FONT_FAMILIES.system;
}

function styleBubbleAction(button) {
  Object.assign(button.style, {
    border: "1px solid rgba(103, 80, 55, 0.2)",
    borderRadius: "999px",
    padding: "6px 10px",
    background: "rgba(255, 255, 255, 0.72)",
    color: "#261a12",
    fontSize: "13px",
    fontWeight: "700",
    fontFamily: "system-ui, sans-serif",
    cursor: "pointer"
  });
}

async function copyBubbleText(copyButton) {
  const text = bubbleText?.textContent || "";
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    copyTextWithFallback(text);
  }

  const originalText = copyButton.textContent;
  copyButton.textContent = "복사됨";
  window.setTimeout(() => {
    copyButton.textContent = originalText;
  }, 1200);
}

function copyTextWithFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  Object.assign(textarea.style, {
    position: "fixed",
    top: "-9999px",
    left: "-9999px"
  });

  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function positionBubble(rect, anchor = lastSelectionAnchor) {
  if (!bubble) {
    return;
  }

  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const gap = 12;
  const bubbleHeight = bubble.offsetHeight;
  const maxLeft = Math.max(12, viewportWidth - bubble.offsetWidth - gap);
  const hasRoomBelow = viewportHeight - anchor.viewportBottom >= bubbleHeight + gap;
  const hasRoomAbove = anchor.viewportTop >= bubbleHeight + gap;
  let top;

  if (hasRoomBelow) {
    top = anchor.bottom + gap;
  } else if (hasRoomAbove) {
    top = anchor.top - bubbleHeight - gap;
  } else {
    const clampedViewportTop = Math.max(gap, viewportHeight - bubbleHeight - gap);
    top = anchor.scrollY + clampedViewportTop;
  }

  const viewportLeft = Math.max(gap, Math.min(anchor.left - anchor.scrollX, maxLeft));
  const left = anchor.scrollX + viewportLeft;

  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
}

function repositionFloatingUi() {
  if (translateButton?.style.display === "block" && lastSelectionRect) {
    renderTranslateButton(lastSelectionRect);
  }

  if (bubble?.style.display === "block" && lastSelectionRect) {
    positionBubble(lastSelectionRect);
  }
}

function hideTranslateButton() {
  if (translateButton) {
    translateButton.style.display = "none";
  }
}

function removeBubble() {
  if (bubble) {
    bubble.style.display = "none";
  }
}

function getRangeRect(range) {
  const rect = range.getBoundingClientRect();
  if (rect.width || rect.height) {
    return rect;
  }

  const rects = range.getClientRects();
  return rects.length > 0 ? rects[0] : null;
}
