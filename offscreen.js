import * as Transformers from './lib/transformers.min.js';

console.log(Transformers); // Проверьте, есть ли здесь cosine_similarity
debugger;
Transformers.env.allowLocalModels = false;
Transformers.env.useBrowserCache = true;

// Указываем путь к ресурсам ONNX Runtime, если они блокируются
// Явно указываем пути к WASM модулям на CDN
// const DIST_URL = 'cdn.jsdelivr.net';
// Transformers.env.backends.onnx.wasm.wasmPaths = DIST_URL;

const libPath = chrome.runtime.getURL('lib/');
Transformers.env.backends.onnx.wasm.wasmPaths = libPath;

let extractor;

async function initModel() {
  if (!extractor) {
    console.log("Инициализация модели...");
    try {
      // Пытаемся запустить через WebGPU
      extractor = await Transformers.pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
        device: 'webgpu',
        dtype: 'fp32' // Явно указываем тип данных, чтобы убрать предупреждение
      });
      console.log("Модель загружена: WebGPU");
    } catch (err) {
      console.warn("WebGPU не удался, пробуем WASM...", err);
      // Резервный вариант через WASM
      extractor = await Transformers.pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
        device: 'wasm',
        dtype: 'q8' // Оптимизированный формат для процессора
      });
      console.log("Модель загружена: WASM");
    }
  }
}


// Слушаем сообщения
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Игнорируем сообщения, не предназначенные нам
  if (message.target !== 'offscreen') return;

  if (message.type === 'COMPUTE_EMBEDDINGS') {
    handleEmbeddings(message);
    return true; // Держим канал открытым
  }
});

async function handleEmbeddings(message) {
  try {
    await initModel();
    const { query, products } = message.data;

    const qOutput = await extractor(query, { pooling: 'mean', normalize: true });
    const qVec = Array.from(qOutput.data);

    const results = [];
    for (const product of products) {
      const pOutput = await extractor(product.text, { pooling: 'mean', normalize: true });
      const pVec = Array.from(pOutput.data);
      const score = Transformers.cos_sim(qVec, pVec);
      results.push({ id: product.id, score });
    }

    chrome.runtime.sendMessage({
      type: 'MATCHING_RESULTS',
      results: results,
      tabId: message.tabId
    });
  } catch (error) {
    console.error("AI Error:", error);
  }
}

// СИГНАЛ ГОТОВНОСТИ: Сообщаем background.js, что мы загрузились
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });

