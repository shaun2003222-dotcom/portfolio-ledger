'use strict';
/**
 * 持倉日誌：只有持倉管理與自動查詢最新收盤價。
 * 個人資料只寫進 localStorage；公開的 quotes/market.json 不含個人持股。
 */
const STORAGE_KEY = 'portfolio-ledger-holdings-v1';
const $ = (id) => document.getElementById(id);
const state = { holdings: [], quotes: {}, markets: {}, generatedAt: null, priceLoading: false, priceError: '', editing: null };
const number = (value, digits = 2) => Number(value).toLocaleString('zh-TW', { maximumFractionDigits: digits });
const money = (value, digits = 2) => 'NT$ ' + number(value, digits);
const escapeHTML = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowText = () => new Date().toLocaleString('zh-TW', { timeZone:'Asia/Taipei', hour12:false });
const dateTPE = () => new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Taipei' });

function notice(text, type = '') {
  const node = $('notice');
  node.textContent = text;
  node.className = `notice ${type}`;
  node.hidden = !text;
}
function normalizeHolding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const symbol = String(raw.symbol ?? '').trim().toUpperCase();
  const market = String(raw.market ?? '').toUpperCase();
  const quantity = Number(raw.quantity), cost = Number(raw.cost);
  if (raw.quantity === '' || raw.quantity == null || raw.cost === '' || raw.cost == null) return null;
  if (!/^[0-9A-Z]{4,12}$/.test(symbol) || !['TWSE','TPEX'].includes(market) ||
      !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost < 0) return null;
  return { id:String(raw.id || createId()), symbol, market, name:String(raw.name || '').slice(0,70), quantity, cost };
}
function createId() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)); }
function readSaved() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    state.holdings = Array.isArray(raw) ? raw.map(normalizeHolding).filter(Boolean) : [];
  } catch { state.holdings = []; notice('無法讀取本機持倉。請確認瀏覽器允許本站儲存資料。','error'); }
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.holdings));
    $('lastSaved').textContent = `本機已儲存 · ${nowText()}`;
    return true;
  } catch {
    notice('瀏覽器本機儲存失敗。請先用「匯出 JSON」備份，並檢查儲存空間或瀏覽器隱私設定。', 'error');
    return false;
  }
}
function quoteFor(market, symbol) { return state.quotes[market + ':' + symbol] || null; }
function infoFor(market, symbol) {
  const quote = quoteFor(market, symbol);
  return quote && Number.isFinite(Number(quote.price)) && Number(quote.price) > 0 ? quote : null;
}
function formatPnl(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v)); }
function buildRow(holding) {
  const quote = infoFor(holding.market, holding.symbol);
  const label = holding.name || (quote && quote.name) || holding.symbol;
  const marketLabel = holding.market === 'TWSE' ? '上市' : '上櫃';
  const value = quote ? holding.quantity * Number(quote.price) : null;
  const costTotal = holding.quantity * holding.cost;
  const pnl = value === null ? null : value - costTotal;
  const pct = pnl === null || costTotal <= 0 ? null : pnl / costTotal * 100;
  const className = pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : '';
  return `<tr>
    <td><span class="symbol-chip">${escapeHTML(holding.symbol)} · ${marketLabel}</span><span class="stock-name">${escapeHTML(label)}</span></td>
    <td><b>${number(holding.quantity, 4)}</b><small>股</small></td>
    <td>${money(holding.cost)}</td>
    <td>${quote ? `<b>${money(quote.price)}</b><small>${escapeHTML(quote.date || '日期未知')} · 收盤</small>` : `<b>—</b><small>查無可用報價</small>`}</td>
    <td>${value === null ? '—' : `<b>${money(value, 0)}</b>`}</td>
    <td>${pnl === null ? '—' : `<b class="${className}">${formatPnl(pnl)}</b>${pct === null ? '' : `<small class="${className}">${pct > 0 ? '+' : ''}${number(pct)}%</small>`}`}</td>
    <td class="right"><div class="row-actions"><button class="icon-button" type="button" data-action="edit" data-id="${escapeHTML(holding.id)}">編輯</button><button class="icon-button danger" type="button" data-action="delete" data-id="${escapeHTML(holding.id)}">刪除</button></div></td>
  </tr>`;
}
function render() {
  const priced = state.holdings.filter(h => infoFor(h.market, h.symbol));
  const total = priced.reduce((sum,h) => sum + h.quantity * Number(infoFor(h.market,h.symbol).price), 0);
  const cost = priced.reduce((sum,h) => sum + h.quantity * h.cost, 0);
  const gain = total - cost;
  $('holdingCount').innerHTML = `${number(state.holdings.length,0)} <span class="stat-unit">檔</span>`;
  $('totalValue').textContent = priced.length ? money(total,0) : (state.holdings.length ? '尚無報價' : 'NT$ 0');
  $('totalPnl').textContent = priced.length ? formatPnl(gain) : '—';
  $('totalPnl').className = 'stat-number ' + (gain > 0 && priced.length ? 'positive' : gain < 0 && priced.length ? 'negative' : '');
  $('totalNote').textContent = `${priced.length}/${state.holdings.length} 檔有報價${priced.length !== state.holdings.length ? '，未報價標的不計入總市值' : ''}`;
  $('pnlNote').textContent = priced.length && cost > 0 ? `報酬率 ${gain > 0 ? '+' : ''}${number(gain / cost * 100)}% · 不含稅費` : '依買入均價計算，不含交易費';
  $('holdingsBody').innerHTML = state.holdings.length ? state.holdings.map(buildRow).join('') : `<tr><td colspan="7" class="empty-cell"><div style="font-size:28px;margin-bottom:8px">◈</div><b>尚未新增任何持股</b><div style="font-size:12px;margin-top:6px">點右上角「＋ 新增持股」，輸入 0050、2330 或其他上市／上櫃代號。</div></td></tr>`;
  const dot = $('quoteDot');
  dot.className = 'status-dot ' + (state.priceLoading ? '' : state.priceError ? 'error' : Object.keys(state.quotes).length ? 'ready' : '');
  const m = state.markets || {};
  const statuses = Object.entries(m).filter(([,v]) => v && v.date).map(([k,v]) => (k==='TWSE'?'上市':'上櫃') + ' ' + v.date);
  $('quoteStatus').textContent = state.priceLoading ? '正在取得官方行情…' : state.priceError ? '報價更新失敗' : statuses.length ? ('最新行情 · ' + statuses.join(' / ')) : '尚未下載官方行情';
  previewQuote();
}
function parseQuotes(data) {
  if (!data || typeof data !== 'object' || !data.quotes || typeof data.quotes !== 'object') throw Error('行情檔案格式錯誤');
  const entries = Object.entries(data.quotes).filter(([k,v]) => /^(TWSE|TPEX):[0-9A-Z]{4,12}$/.test(k) && v && Number(v.price) > 0 && Number.isFinite(Number(v.price)));
  return { quotes:Object.fromEntries(entries), markets:data.markets || {}, generatedAt:data.generatedAt || null };
}
async function refreshQuotes() {
  if(state.priceLoading) return;
  state.priceLoading = true;state.priceError = '';
  $('refreshQuotes').disabled = true;render();
  try {
    const response = await fetch(`./quotes/market.json?update=${Date.now()}`, { cache:'no-store' });
    if(!response.ok) throw Error('HTTP ' + response.status);
    const result = parseQuotes(await response.json());
    if(!Object.keys(result.quotes).length) throw Error('尚無已下載的報價資料');
    state.quotes = result.quotes;state.markets=result.markets;state.generatedAt=result.generatedAt;
    let stale = Object.values(result.markets).some(v => v && v.error);
    if(stale) notice('部分交易所資料暫時無法更新，顯示最後成功取得的收盤報價，請留意日期。');
    else notice('');
  } catch(err) {
    state.priceError = err.message || String(err);
    notice('目前無法載入股價。請確認已執行 tools/update_quotes.py，或在 GitHub Actions 執行「更新台股收盤行情」。持倉仍會保留。', 'error');
  } finally {
    state.priceLoading = false;$('refreshQuotes').disabled=false;render();
  }
}
function openDialog(item=null) {
  $('holdingForm').reset();
  state.editing = item ? item.id : null;
  $('dialogTitle').textContent = item ? '編輯持股' : '新增持股';
  $('holdingId').value = item ? item.id : '';
  $('symbol').value = item ? item.symbol : '';
  $('market').value = item ? item.market : 'TWSE';
  $('holdingName').value = item ? item.name : '';
  $('quantity').value = item ? item.quantity : '';
  $('cost').value = item ? item.cost : '';
  $('formError').textContent='';
  previewQuote();
  $('holdingDialog').showModal();
  $('symbol').focus();
}
function closeDialog() { $('holdingDialog').close(); }
function autoMarket() {
  const symbol = $('symbol').value.trim().toUpperCase();
  const twse = infoFor('TWSE',symbol), tpex = infoFor('TPEX',symbol);
  if(twse && !tpex) $('market').value='TWSE';
  else if(tpex && !twse) $('market').value='TPEX';
  const quote = infoFor($('market').value,symbol);
  if(quote && !$('holdingName').value.trim()) $('holdingName').placeholder=`自動顯示：${quote.name || symbol}`;
  previewQuote();
}
function previewQuote() {
  const symbol=$('symbol').value.trim().toUpperCase(), market=$('market').value;
  const quote=infoFor(market,symbol);
  $('previewPrice').textContent = quote ? money(quote.price) : (symbol ? '查無報價' : '請輸入股票代號');
  $('previewInfo').textContent = quote ? `${quote.date || '日期未知'} 收盤 · ${quote.name || ''}` : (symbol ? '儲存持股後可持續更新；請確認代號及上市／上櫃。' : '資料來自官方最近交易日行情。');
}
function saveHolding(event) {
  event.preventDefault();
  $('formError').textContent='';
  const item=normalizeHolding({id:$('holdingId').value || createId(),symbol:$('symbol').value,market:$('market').value,name:$('holdingName').value.trim(),quantity:$('quantity').value,cost:$('cost').value});
  if(!item){$('formError').textContent='請確認股票代號、股數（大於 0）及買進成本（0 或以上）。';return;}
  const same=state.holdings.find(h=>h.symbol===item.symbol && h.market===item.market && h.id!==item.id);
  if(same){$('formError').textContent='這檔股票已在持倉中，請編輯原本那筆股數及平均成本。';return;}
  const old=state.holdings.findIndex(h=>h.id===item.id);
  if(old>=0) state.holdings[old]=item;
  else state.holdings.push(item);
  if(!persist())return;
  closeDialog();render();
}
function handleTableClick(event) {
  const button=event.target.closest('button[data-action]');
  if(!button)return;
  const holding=state.holdings.find(h=>h.id===button.dataset.id);
  if(!holding)return;
  if(button.dataset.action==='edit')openDialog(holding);
  if(button.dataset.action==='delete') {
    if(!confirm(`確定刪除 ${holding.name || holding.symbol}（${holding.symbol}）的持倉紀錄？`))return;
    state.holdings=state.holdings.filter(h=>h.id!==holding.id);
    persist();render();
  }
}
function exportBackup() {
  const payload={format:'portfolio-ledger-v1',exportedAt:new Date().toISOString(),holdings:state.holdings};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`持倉備份_${dateTPE()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importBackup(event) {
  const file=event.target.files && event.target.files[0];if(!file)return;
  event.target.value='';
  try {
    if(file.size > 2*1024*1024)throw Error('備份檔案超過 2 MB');
    const doc=JSON.parse(await file.text());
    if(doc.format!=='portfolio-ledger-v1'||!Array.isArray(doc.holdings))throw Error('非本系統的持倉備份格式');
    if(doc.holdings.length>2000)throw Error('備份持倉數過多');
    const rows=doc.holdings.map(normalizeHolding);
    if(rows.some(x=>!x))throw Error('備份中有不合法的資料');
    if(!confirm(`這份備份有 ${rows.length} 筆持倉。匯入會覆蓋目前本機的 ${state.holdings.length} 筆紀錄，確定嗎？`))return;
    state.holdings=rows;persist();render();notice('已匯入持倉備份。');
  } catch(e){notice('匯入失敗：'+(e.message||e),'error');}
}
function init() {
  readSaved();render();
  $('newHolding').addEventListener('click',()=>openDialog());
  $('refreshQuotes').addEventListener('click',refreshQuotes);
  $('holdingsBody').addEventListener('click',handleTableClick);
  $('closeDialog').addEventListener('click',closeDialog);
  $('cancelDialog').addEventListener('click',closeDialog);
  $('holdingForm').addEventListener('submit',saveHolding);
  $('symbol').addEventListener('input',autoMarket);
  $('market').addEventListener('change',previewQuote);
  $('exportData').addEventListener('click',exportBackup);
  $('importButton').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',importBackup);
  refreshQuotes();
}
init();
