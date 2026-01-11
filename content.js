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
  await waitForElm('.product-card__wrapper');
  const query = document.getElementById('searchInput')?.value || "";
  const cards = document.querySelectorAll('.product-card__wrapper');
  const products = [];

  cards.forEach((card, index) => {
    card.setAttribute('data-ai-id', index);
    const title = card.querySelector('.product-card__name')?.innerText || "";
    const brand = card.querySelector('.product-card__brand')?.innerText || "";
    products.push({ id: index, text: `${brand} ${title}` });
  });

  if (query && products.length > 0) {
    chrome.runtime.sendMessage({
        type: 'ANALYZE_WB',
        target: 'offscreen',
        data: { query, products }
    });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'UI_UPDATE') {
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
  badge.style = `
    position: absolute; top: 10px; right: 10px; background: ${percent > 70 ? '#4caf50' : '#ff9800'};
    color: white; padding: 4px 8px; border-radius: 8px; font-size: 12px; font-weight: bold; z-index: 9;
  `;
}

scanPage();

let lastUrl = location.href;
setInterval(() => {
    console.log("TICK");
   if (location.href !== lastUrl) {
//  if (true) {
    console.log("TACK");
    lastUrl = location.href;
    setTimeout(scanPage, 1500);
  }
}, 2000);
