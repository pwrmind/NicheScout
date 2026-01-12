let isProcessing = false;
let lastProcessedTime = 0;
const MIN_INTERVAL = 3000; // Минимум 3 секунды между обработками
let timeout;

function waitForElm(selector) {
  return new Promise(resolve => {
    if (document.querySelector(selector)) return resolve(document.querySelector(selector));
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) { resolve(document.querySelector(selector)); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function scanPage() {
  // Защита от слишком частых вызовов
  const now = Date.now();
  if (isProcessing || (now - lastProcessedTime < MIN_INTERVAL)) {
    console.log("Scan skipped: too frequent");
    return;
  }
  
  isProcessing = true;
  try {
    await waitForElm('.product-card__wrapper');
    const query = document.getElementById('searchInput')?.value || "";
    const cards = document.querySelectorAll('.product-card__wrapper');
    
    if (!query || cards.length === 0) {
      console.log("No query or cards found");
      return;
    }
    
    const products = [];
    cards.forEach((card, index) => {
      card.setAttribute('data-ai-id', index);
      const title = card.querySelector('.product-card__name')?.innerText || "";
      const brand = card.querySelector('.product-card__brand')?.innerText || "";
      products.push({ 
        id: index, 
        text: `${brand} ${title}`.trim() 
      });
    });
    
    console.log(`Sending ${products.length} products for analysis`);
    chrome.runtime.sendMessage({
      type: 'ANALYZE_WB',
      data: { query, products }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.log("Message send error (expected for async):", chrome.runtime.lastError.message);
      }
    });
    
    lastProcessedTime = Date.now();
  } catch (error) {
    console.error("Scan error:", error);
  } finally {
    isProcessing = false;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UI_UPDATE') {
    console.log("Received UI_UPDATE with", msg.results.length, "results");
    msg.results.forEach(res => {
      const card = document.querySelector(`.product-card__wrapper[data-ai-id="${res.id}"]`);
      if (card) updateUI(card, res.score);
    });
  }
});

function updateUI(card, score) {
  let badge = card.querySelector('.ai-score-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'ai-score-badge';
    card.style.position = 'relative';
    card.appendChild(badge);
  }
  const percent = Math.round(score * 100);
  badge.innerText = `${percent}%`;
  badge.style.cssText = `
    position: absolute; top: 10px; right: 10px; background: ${percent > 70 ? '#4caf50' : '#ff9800'};
    color: white; padding: 4px 8px; border-radius: 8px; font-size: 12px; font-weight: bold; z-index: 9;
  `;
}

// Первоначальное сканирование
setTimeout(() => {
  scanPage();
}, 1000);

const DEBOUNCE_TIME = 1000;

// 1. Функция-обертка для запуска сканирования с защитой от частых вызовов (Debounce)
function debouncedScan() {
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
        await scanPage();
    }, DEBOUNCE_TIME);
}

// 2. Отслеживание навигации (для SPA приложений и смены URL)
if (window.navigation) {
    window.navigation.addEventListener('navigate', (event) => {
        // Запускаем сканирование при переходе на новый URL
        debouncedScan();
    });
} else {
    // Резервный вариант для старых версий
    window.addEventListener('popstate', debouncedScan);
    window.addEventListener('hashchange', debouncedScan);
}

// 3. Отслеживание появления новых элементов
const observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
        if (mutation.addedNodes.length) {
            debouncedScan();
            break; 
        }
    }
});

// Начинаем наблюдение за изменениями в теле страницы
observer.observe(document.body, {
    childList: true,
    subtree: true
});

// 4. Пассивный слушатель скролла
window.addEventListener('scroll', debouncedScan, { passive: true });

// 5. Отслеживание изменения поискового запроса
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', debouncedScan);
}