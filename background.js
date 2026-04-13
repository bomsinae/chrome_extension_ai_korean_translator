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
  if (message?.type === "TRANSLATE_TEXT") {
    translateText(message.text)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "TRANSLATE_TEXT_BATCH") {
    translateTextBatch(message.items || message.texts)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  return false;
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

async function translateTextBatch(items) {
  const textItems = normalizeTranslationItems(items);

  if (!textItems.length || textItems.some((item) => !item.id || !item.text)) {
    throw new Error("번역할 화면 문장을 찾지 못했습니다.");
  }

  const expectedIds = textItems.map((item) => item.id);
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.apiKey) {
    throw new Error("옵션 페이지에서 OpenAI API 키를 먼저 설정하세요.");
  }

  const tone = settings.translationTone || DEFAULT_SETTINGS.translationTone;
  const model = settings.model || DEFAULT_SETTINGS.model;
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
                "The user's input is a JSON array of objects with id and text fields.",
                "Translate each text field into Korean.",
                getToneInstruction(tone),
                "Preserve each item's meaning and tone.",
                "Return only a valid JSON array of objects.",
                "Each object must have exactly the same id and a translation field.",
                "Use this exact object shape: {\"id\":\"same id\",\"translation\":\"Korean translation\"}.",
                `Return exactly these ${expectedIds.length} ids: ${expectedIds.join(", ")}.`,
                "Do not include Markdown fences, explanations, or numbering."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(textItems)
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
  const translatedText = extractOutputText(data);
  const translations = parseTranslationItems(translatedText, expectedIds);
  return translations;
}

function normalizeTranslationItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `item-${index}`,
        text: item.trim()
      };
    }

    return {
      id: `${item?.id || ""}`.trim(),
      text: `${item?.text || ""}`.trim()
    };
  });
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

function parseTranslationItems(text, expectedIds) {
  const trimmedText = `${text || ""}`.trim();
  if (!trimmedText) {
    throw new Error("화면 번역 결과를 읽지 못했습니다.");
  }

  const expectedIdSet = new Set(expectedIds);
  const jsonText = stripJsonFence(trimmedText);
  const candidates = [jsonText];
  const arrayStart = jsonText.indexOf("[");
  const arrayEnd = jsonText.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(jsonText.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        continue;
      }

      const translationsById = new Map();
      for (const item of parsed) {
        const id = `${item?.id || ""}`.trim();
        const translation = `${item?.translation || ""}`.trim();

        if (!id || !expectedIdSet.has(id)) {
          continue;
        }

        if (translationsById.has(id)) {
          throw new Error("화면 번역 결과 ID가 중복되었습니다.");
        }

        if (!translation) {
          throw new Error("화면 번역 결과를 읽지 못했습니다.");
        }

        translationsById.set(id, translation);
      }

      const missingId = expectedIds.find((id) => !translationsById.has(id));
      if (missingId) {
        throw new Error("화면 번역 결과 ID가 원문과 맞지 않습니다.");
      }

      return expectedIds.map((id) => ({
        id,
        translation: translationsById.get(id)
      }));
    } catch (error) {
      if (
        error.message === "화면 번역 결과 ID가 원문과 맞지 않습니다." ||
        error.message === "화면 번역 결과 ID가 중복되었습니다." ||
        error.message === "화면 번역 결과를 읽지 못했습니다."
      ) {
        throw error;
      }
    }
  }

  throw new Error("화면 번역 결과를 JSON으로 읽지 못했습니다.");
}

function stripJsonFence(text) {
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : text;
}
