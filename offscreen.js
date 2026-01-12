import * as Transformers from './lib/transformers.min.js';

console.log("Transformers loaded:", Transformers);

// Проверяем доступность методов
if (!Transformers.cos_sim && Transformers.cosine_similarity) {
  Transformers.cos_sim = Transformers.cosine_similarity;
}
if (!Transformers.cos_sim) {
  console.error("cos_sim/cosine_similarity not found in Transformers!");
}

Transformers.env.allowLocalModels = false;
Transformers.env.useBrowserCache = true;

const libPath = chrome.runtime.getURL('lib/');
Transformers.env.backends.onnx.wasm.wasmPaths = libPath;

let extractor = null;
let isInitializing = false;
let initPromise = null;

async function initModel() {
  if (extractor) return extractor;
  if (isInitializing) {
    return initPromise;
  }
  
  isInitializing = true;
  console.log("Инициализация модели...");
  
  initPromise = (async () => {
    try {
      // Попытка WebGPU
      extractor = await Transformers.pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
        device: 'webgpu',
        dtype: 'fp32'
      });
      console.log("Модель загружена: WebGPU");
    } catch (err) {
      console.warn("WebGPU failed, trying WASM...", err);
      
      // Резерв: WASM
      extractor = await Transformers.pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
        device: 'wasm',
        dtype: 'q8'
      });
      console.log("Модель загружена: WASM");
    }
    
    isInitializing = false;
    return extractor;
  })();
  
  return initPromise;
}

// Сразу инициализируем модель при загрузке
initModel().then(() => {
  console.log("Модель инициализирована, отправляем READY");
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
}).catch(err => {
  console.error("Model initialization failed:", err);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;
  
  if (message.type === 'COMPUTE_EMBEDDINGS') {
    handleEmbeddings(message);
    return true;
  }
});

async function handleEmbeddings(message) {
  try {
    console.log("Processing embeddings for query:", message.data.query.substring(0, 50));
    
    await initModel();
    const { query, products } = message.data;
    
    if (!extractor) {
      throw new Error("Extractor not initialized");
    }
    
    // 1. Эмбеддинг запроса
    const qOutput = await extractor(`query: ${query}`, { 
      pooling: 'mean', 
      normalize: true 
    });
    const qVec = Array.from(qOutput.data);
    
    // 2. Эмбеддинги товаров (батчем)
    const passages = products.map(p => `passage: ${p.text}`);
    const pOutputs = await extractor(passages, { 
      pooling: 'mean', 
      normalize: true 
    });
    
    // 3. Расчет косинусного сходства
    const pVectors = pOutputs.tolist();
    const results = [];
    
    for (let i = 0; i < products.length; i++) {
      const pVec = pVectors[i];
      let score = 0;
      
      try {
        // Проверяем разные варианты названия функции
        if (Transformers.cos_sim) {
          score = Transformers.cos_sim(qVec, pVec);
        } else if (Transformers.cosine_similarity) {
          score = Transformers.cosine_similarity(qVec, pVec);
        } else {
          // Ручной расчет
          const dotProduct = qVec.reduce((sum, val, idx) => sum + val * pVec[idx], 0);
          const qNorm = Math.sqrt(qVec.reduce((sum, val) => sum + val * val, 0));
          const pNorm = Math.sqrt(pVec.reduce((sum, val) => sum + val * val, 0));
          score = dotProduct / (qNorm * pNorm);
        }
      } catch (err) {
        console.error("Error calculating similarity:", err);
        score = 0;
      }
      
      // Если score - это объект (например, тензор), извлекаем значение
      if (score && typeof score === 'object' && 'item' in score) {
        score = score.item();
      }
      
      results.push({ 
        id: products[i].id, 
        score: typeof score === 'number' ? score : 0
      });
    }
    
    console.log("Sending results for tab:", message.tabId);
    chrome.runtime.sendMessage({
      type: 'MATCHING_RESULTS',
      results: results,
      tabId: message.tabId
    });
    
  } catch (error) {
    console.error("AI Error in handleEmbeddings:", error);
    // Отправляем пустые результаты в случае ошибки
    chrome.runtime.sendMessage({
      type: 'MATCHING_RESULTS',
      results: message.data.products.map(p => ({ id: p.id, score: 0 })),
      tabId: message.tabId
    });
  }
}