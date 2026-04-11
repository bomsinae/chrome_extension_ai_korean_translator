const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gpt-4.1-mini"
};

const form = document.getElementById("settingsForm");
const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const saveStatus = document.getElementById("saveStatus");

loadSettings();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await chrome.storage.sync.set({
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || DEFAULT_SETTINGS.model
  });

  saveStatus.textContent = "저장되었습니다.";
  saveStatus.dataset.error = "false";
});

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  apiKeyInput.value = settings.apiKey;
  modelInput.value = settings.model;
}
