const sourceText = document.getElementById("sourceText");
const translatedText = document.getElementById("translatedText");
const statusText = document.getElementById("status");
const translateButton = document.getElementById("translateButton");
const translatePageButton = document.getElementById("translatePageButton");
const restorePageButton = document.getElementById("restorePageButton");
const openOptionsButton = document.getElementById("openOptionsButton");

initialize();

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    setStatus("활성 탭을 찾지 못했습니다.", true);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTED_TEXT" });
    sourceText.value = response?.text || "";
    if (!sourceText.value) {
      setStatus("페이지에서 문장을 선택하면 여기로 가져옵니다.", false);
    }
  } catch (_error) {
    setStatus("이 페이지에서는 선택 텍스트를 읽지 못했습니다.", true);
  }
}

translateButton.addEventListener("click", async () => {
  const text = sourceText.value.trim();
  if (!text) {
    setStatus("번역할 문장을 입력하거나 페이지에서 선택하세요.", true);
    return;
  }

  setLoading(true);
  setStatus("번역 중...", false);
  translatedText.value = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      text
    });

    if (!response?.ok) {
      throw new Error(response?.error || "알 수 없는 오류");
    }

    translatedText.value = response.result;
    setStatus("번역 완료", false);
  } catch (error) {
    setStatus(error.message || "번역 중 오류가 발생했습니다.", true);
  } finally {
    setLoading(false);
  }
});

translatePageButton.addEventListener("click", async () => {
  setPageLoading(true);
  setStatus("보이는 부분 번역을 시작합니다...", false);

  try {
    const tabId = await getActiveTabId();
    const response = await chrome.tabs.sendMessage(tabId, { type: "TRANSLATE_PAGE" });

    if (!response?.ok) {
      throw new Error(response?.error || "알 수 없는 오류");
    }

    window.close();
  } catch (error) {
    setStatus(error.message || "화면 번역 중 오류가 발생했습니다.", true);
    setPageLoading(false);
  }
});

restorePageButton.addEventListener("click", async () => {
  setPageLoading(true);
  setStatus("원문으로 복원 중...", false);

  try {
    const tabId = await getActiveTabId();
    const response = await chrome.tabs.sendMessage(tabId, { type: "RESTORE_PAGE_TRANSLATION" });

    if (!response?.ok) {
      throw new Error(response?.error || "알 수 없는 오류");
    }

    setStatus(`원문으로 복원했습니다 (${response.count}개).`, false);
  } catch (error) {
    setStatus(error.message || "원문 복원 중 오류가 발생했습니다.", true);
  } finally {
    setPageLoading(false);
  }
});

openOptionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("활성 탭을 찾지 못했습니다.");
  }

  return tab.id;
}

function setLoading(isLoading) {
  translateButton.disabled = isLoading;
  translateButton.textContent = isLoading ? "번역 중..." : "한글로 번역";
}

function setPageLoading(isLoading) {
  translatePageButton.disabled = isLoading;
  restorePageButton.disabled = isLoading;
  translatePageButton.textContent = isLoading ? "화면 번역 중..." : "보이는 부분 번역";
}

function setStatus(message, isError) {
  statusText.textContent = message;
  statusText.dataset.error = isError ? "true" : "false";
}
