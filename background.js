let pendingData = null; // Очередь для данных, пока offscreen грузится

async function setupOffscreen() {
  //if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Run AI models via WebGPU'
    });
  } catch (error) {
    // if (error.message.includes('"Only a single offscreen document may be created.')) {
    //     // Safe to ignore; document is already running
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
    // }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Получаем команду от контент-скрипта
  if (message.type === 'ANALYZE_WB') {
    pendingData = {
      data: message.data,
      tabId: sender.tab.id
    };
    setupOffscreen();
    //return true;
  }

  // 2. Ждем сигнала готовности от offscreen.js
  if (message.type === 'OFFSCREEN_READY') {
    if (pendingData) {
      chrome.runtime.sendMessage({
            type: 'COMPUTE_EMBEDDINGS',
            target: 'offscreen',
            data: pendingData.data,
            tabId: pendingData.tabId
        }).catch(err => {
            // Игнорируем ошибку таймаута при первой долгой загрузке модели
            if (!err.message.includes("message channel closed")) {
                console.error("Ошибка:", err);
            }
        });
    }
  }

  // 3. Пересылаем результаты обратно в Wildberries
  if (message.type === 'MATCHING_RESULTS') {
    chrome.tabs.sendMessage(message.tabId, {
      type: 'UI_UPDATE',
      target: 'offscreen',
      results: message.results
    }).catch(() => null);
  }
});
