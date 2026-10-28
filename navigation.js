'use strict';
/** Single-page menu routing: keep all the original calculation nodes mounted. */
(() => {
  const PAGES = {
    overview: ['ASSET OVERVIEW / 資產總覽', '我的資產總覽', '分類、行情、市值與損益一目了然。'],
    holdings: ['HOLDINGS / 持倉管理', '我的持倉管理', '新增及編輯台股、美股、基金、加密貨幣等資產。'],
    goals: ['ANNUAL GOALS / 年度目標', '年度投資目標', '設定資產成長與配置比例，檢視偏離情況。'],
    advice: ['ALLOCATION PLAN / 下一筆投入', '下一筆資金怎麼分配？', '依自行設定的目標比例，試算新資金配置方向。']
  };
  function navigate() {
    const page = Object.hasOwn(PAGES, location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    document.querySelectorAll('[data-page]').forEach(el => { el.hidden = el.dataset.page !== page; });
    document.querySelectorAll('[data-nav]').forEach(el => {
      const active = el.dataset.nav === page;
      el.classList.toggle('nav-selected', active);
      el.classList.toggle('side-link', !active);
      if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    const [eyebrow,title,subtitle] = PAGES[page];
    document.getElementById('pageEyebrow').textContent = eyebrow;
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageSubtitle').textContent = subtitle;
    window.scrollTo({top:0,behavior:'instant'});
  }
  window.addEventListener('hashchange', navigate);
  document.addEventListener('click', ev => {
    const link = ev.target.closest('a[href^="#"]');
    if (link && link.hash === location.hash) navigate();
  });
  navigate();
})();
