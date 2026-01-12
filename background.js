let pendingData = null; // Очередь для данных, пока offscreen грузится

async function setupOffscreen() {
  // Проверяем, существует ли уже документ
  if (await chrome.offscreen.hasDocument()) {
    console.log("Offscreen document already exists");
    // Отправляем сигнал готовности сразу
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
    return;
  }
  
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run AI models via WebGPU'
    });
    console.log("Offscreen document created");
  } catch (error) {
    console.error("Error creating offscreen:", error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Получаем команду от контент-скрипта
  if (message.type === 'ANALYZE_WB') {
    pendingData = {
      data: message.data,
      tabId: sender.tab.id
    };
    console.log("Received ANALYZE_WB, setting up offscreen");
    setupOffscreen();
  }

  // 2. Ждем сигнала готовности от offscreen.js
  if (message.type === 'OFFSCREEN_READY') {
    console.log("Received OFFSREEN_READY, pendingData:", pendingData ? "yes" : "no");
    if (pendingData) {
      chrome.runtime.sendMessage({
        type: 'COMPUTE_EMBEDDINGS',
        target: 'offscreen',
        data: pendingData.data,
        tabId: pendingData.tabId
      }).catch(err => {
        // Игнорируем ошибку таймаута при первой долгой загрузке модели
        if (!err.message.includes("message channel closed")) {
          console.error("Ошибка при отправке в offscreen:", err);
        }
      });
      pendingData = null; // Очищаем очередь
    }
  }

  // 3. Пересылаем результаты обратно в Wildberries
  if (message.type === 'MATCHING_RESULTS') {
    console.log("Received MATCHING_RESULTS for tab:", message.tabId, "results:", message.results.length);
    chrome.tabs.sendMessage(message.tabId, {
      type: 'UI_UPDATE',
      results: message.results
    }).catch((err) => {
      console.log("Could not send to tab (may be reloaded):", err.message);
    });
  }
  
  // Сообщаем, что мы будем отвечать асинхронно
  return true;
});