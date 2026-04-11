const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gpt-4.1-mini",
  translationTone: "natural"
};
const CACHE_KEY = "translationCache";
const MAX_CACHE_ITEMS = 50;

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

  await translateInTab(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "translate-selection") {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  await translateInTab(tab.id);
});

async function translateInTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "SHOW_TRANSLATOR_POPUP"
    });
  } catch (_error) {
    // Chrome internal pages and some restricted pages cannot receive content-script messages.
  }
}

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

  const tone = settings.translationTone || DEFAULT_SETTINGS.translationTone;
  const model = settings.model || DEFAULT_SETTINGS.model;
  const cached = await getCachedTranslation(trimmedText, model, tone);
  if (cached) {
    return cached;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are a translation engine.",
                "Translate the user's selected text into natural Korean.",
                getToneInstruction(tone),
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

  await saveCachedTranslation(trimmedText, model, tone, translated);
  return translated;
}

function getToneInstruction(tone) {
  const instructions = {
    natural: "Use natural Korean that reads smoothly.",
    literal: "Translate as literally as possible while keeping it understandable.",
    formal: "Use polite, formal Korean.",
    concise: "Make the Korean translation concise and compact."
  };

  return instructions[tone] || instructions.natural;
}

async function getCachedTranslation(text, model, tone) {
  const { [CACHE_KEY]: cache = [] } = await chrome.storage.local.get({ [CACHE_KEY]: [] });
  const cacheKey = makeCacheKey(text, model, tone);
  const item = cache.find((entry) => entry.key === cacheKey);
  return item?.translation || "";
}

async function saveCachedTranslation(text, model, tone, translation) {
  const { [CACHE_KEY]: cache = [] } = await chrome.storage.local.get({ [CACHE_KEY]: [] });
  const cacheKey = makeCacheKey(text, model, tone);
  const nextCache = [
    {
      key: cacheKey,
      translation,
      updatedAt: Date.now()
    },
    ...cache.filter((entry) => entry.key !== cacheKey)
  ].slice(0, MAX_CACHE_ITEMS);

  await chrome.storage.local.set({ [CACHE_KEY]: nextCache });
}

function makeCacheKey(text, model, tone) {
  return JSON.stringify({ text, model, tone });
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
