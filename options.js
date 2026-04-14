const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gpt-5.4-mini",
  translationTone: "natural",
  bubbleFont: "system",
  showInlineButton: true
};

const form = document.getElementById("settingsForm");
const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const translationToneInput = document.getElementById("translationTone");
const bubbleFontInput = document.getElementById("bubbleFont");
const showInlineButtonInput = document.getElementById("showInlineButton");
const saveStatus = document.getElementById("saveStatus");

loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await chrome.storage.sync.set({
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || DEFAULT_SETTINGS.model,
    translationTone: translationToneInput.value || DEFAULT_SETTINGS.translationTone,
    bubbleFont: bubbleFontInput.value || DEFAULT_SETTINGS.bubbleFont,
    showInlineButton: showInlineButtonInput.checked
  });

  saveStatus.textContent = "저장되었습니다.";
  saveStatus.dataset.error = "false";
});

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  apiKeyInput.value = settings.apiKey;
  modelInput.value = settings.model;
  translationToneInput.value = settings.translationTone;
  bubbleFontInput.value = settings.bubbleFont;
  showInlineButtonInput.checked = settings.showInlineButton;
}
