let lastSelection = "";
let lastSelectionRect = null;
let translateButton = null;
let bubble = null;
let bubbleText = null;
let bubbleActions = null;
let activeRequestId = 0;
let isPointerSelecting = false;
let lastPointerPosition = null;
let hiddenSelectionText = "";
let lastSelectionAnchor = null;
let showInlineButton = true;

loadInlineButtonSetting();
document.addEventListener("selectionchange", handleSelectionChange);
document.addEventListener("mousedown", handleDocumentMouseDown, true);
document.addEventListener("mouseup", handlePointerSelectionEnd, true);
document.addEventListener("keyup", handleKeyboardSelectionEnd, true);
window.addEventListener("scroll", hideTranslateButton, true);
window.addEventListener("resize", repositionFloatingUi);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.showInlineButton) {
    return;
  }

  showInlineButton = changes.showInlineButton.newValue !== false;
  if (!showInlineButton) {
    hideTranslateButton();
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

async function loadInlineButtonSetting() {
  const settings = await chrome.storage.sync.get({ showInlineButton: true });
  showInlineButton = settings.showInlineButton !== false;
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

    showBubbleAtCurrentSelection(error.message || "번역 중 오류가 발생했습니다.", true);
  }
}

function showBubbleAtCurrentSelection(message, isError, isLoading = false) {
  if (!lastSelectionRect || !lastSelectionAnchor) {
    return;
  }

  if (!bubble) {
    bubble = document.createElement("div");
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
      fontFamily: "Georgia, 'Times New Roman', serif",
      boxShadow: "0 18px 45px rgba(61, 37, 21, 0.16)",
      whiteSpace: "pre-wrap"
    });

    bubbleText = document.createElement("div");
    bubbleActions = document.createElement("div");

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
      gap: "8px",
      marginTop: "12px"
    });

    bubbleActions.append(copyButton, closeButton);
    bubble.append(bubbleText, bubbleActions);
    document.body.appendChild(bubble);
  }

  bubbleText.textContent = message;
  bubble.dataset.error = isError ? "true" : "false";
  bubble.style.color = isError ? "#9f1239" : "#261a12";
  bubble.style.opacity = isLoading ? "0.82" : "1";
  bubbleActions.style.display = isLoading ? "none" : "flex";
  bubble.style.display = "block";

  positionBubble(lastSelectionRect, lastSelectionAnchor);
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
