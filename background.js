const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gpt-4.1-mini"
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "translate-selection",
    title: "선택 문장 번역하기",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "translate-selection" || !tab?.id) {
    return;
  }

  await chrome.tabs.sendMessage(tab.id, {
    type: "SHOW_TRANSLATOR_POPUP"
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TRANSLATE_TEXT") {
    return false;
  }

  translateText(message.text)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function translateText(text) {
  const trimmedText = `${text || ""}`.trim();
  if (!trimmedText) {
    throw new Error("번역할 문장을 먼저 선택하세요.");
  }

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.apiKey) {
    throw new Error("옵션 페이지에서 OpenAI API 키를 먼저 설정하세요.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_SETTINGS.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are a translation engine.",
                "Translate the user's selected text into natural Korean.",
                "Preserve the original meaning and tone.",
                "Return only the Korean translation with no explanation."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: trimmedText
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 요청 실패: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const translated = extractOutputText(data);
  if (!translated) {
    throw new Error("번역 결과를 읽지 못했습니다.");
  }

  return translated;
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const outputs = Array.isArray(data?.output) ? data.output : [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        const value = content.text.trim();
        if (value) {
          return value;
        }
      }
    }
  }

  return "";
}
