'use strict';
/* v2 keeps the original holdings storage key to preserve all previously entered TWSE/TPEX positions. */
const STORAGE_KEY = 'portfolio-ledger-holdings-v1';
const GOAL_KEY = 'portfolio-ledger-goals-v2';
const FX_CACHE_KEY = 'portfolio-ledger-fx-auto-v1';
const ADVICE_BUDGET_KEY = 'portfolio-ledger-advice-budget-v1';
const FX_FIAT_MAX_AGE = 24 * 60 * 60 * 1000;
const FX_USDT_MAX_AGE = 15 * 60 * 1000;
const FX_STALE_LIMIT = 14 * 24 * 60 * 60 * 1000;
const CATEGORIES = [
  {id:'tw',name:'台股 / 台灣 ETF',short:'台股',color:'#238e81'},
  {id:'us',name:'美股',short:'美股',color:'#527fd4'},
  {id:'fund',name:'基金',short:'基金',color:'#9463c9'},
  {id:'crypto',name:'加密貨幣',short:'加密貨幣',color:'#e9aa4d'},
  {id:'bond',name:'債券',short:'債券',color:'#68aac2'},
  {id:'cash',name:'現金 / 存款',short:'現金',color:'#7e98a3'},
  {id:'other',name:'其他資產',short:'其他',color:'#bb8298'},
  {id:'futures',name:'期貨（名目曝險另列）',short:'期貨',color:'#dd7559'}
];
const $ = id => document.getElementById(id);
const state = {holdings:[],goals:defaultGoals(),quotes:{},markets:{},generatedAt:null,priceLoading:false,priceError:'',editing:null,fxAuto:{fiat:null,usdt:null},fxLoading:false,fxErrors:[]};
function defaultGoals(){return {year:Number(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}).slice(0,4)),amount:null,contributionGoal:null,contributionActual:null,fx:{USD:null,EUR:null,JPY:null,USDT:null},targets:{}};}
const number=(v,d=2)=>Number(v).toLocaleString('zh-TW',{maximumFractionDigits:d});
const money=(v,d=0)=>'NT$ '+number(v,d);
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localTime=()=>new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
const localDate=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
const currencyText=(amount,ccy)=>({TWD:'NT$',USD:'US$',EUR:'€',JPY:'¥',USDT:'USDT '})[ccy]+number(amount,ccy==='JPY'?0:4);
const categoryById=id=>CATEGORIES.find(c=>c.id===id)||CATEGORIES[6];
const createId=()=>globalThis.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
function msg(text,type=''){const n=$('notice');n.textContent=text;n.className='notice '+type;n.hidden=!text;}
function finiteMaybe(value){if(value===''||value===null||value===undefined)return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function normalizeHolding(raw){
  if(!raw||typeof raw!=='object')return null;
  const category=CATEGORIES.some(c=>c.id===raw.category)?raw.category:'tw';
  const market=['TWSE','TPEX','MANUAL'].includes(raw.market)?raw.market:'MANUAL';
  const symbol=String(raw.symbol||'').trim().toUpperCase().slice(0,28);
  const name=String(raw.name||'').trim().slice(0,70);
  const quantity=finiteMaybe(raw.quantity),cost=category==='cash'?1:finiteMaybe(raw.cost);
  if(!symbol&&!name)return null;
  if(market!=='MANUAL'&&!/^[0-9A-Z]{4,12}$/.test(symbol))return null;
  if(quantity===null||quantity<=0||cost===null||cost<0)return null;
  let currency=['TWD','USD','EUR','JPY','USDT'].includes(raw.currency)?raw.currency:'TWD';
  if(market!=='MANUAL')currency='TWD';
  const manualPrice=category==='cash'?1:finiteMaybe(raw.manualPrice);
  const multiplier=finiteMaybe(raw.multiplier);
  if(category==='futures'&&(!multiplier||multiplier<=0))return null;
  const margin=finiteMaybe(raw.margin);
  return {id:String(raw.id||createId()),category,market,symbol,name,quantity,cost,currency,manualPrice:manualPrice!==null&&manualPrice>=0?manualPrice:null,multiplier:category==='futures'?multiplier:1,margin:margin!==null&&margin>=0?margin:0,direction:raw.direction==='short'?'short':'long'};
}
function normalizeGoals(raw){
  const out=defaultGoals();if(!raw||typeof raw!=='object')return out;
  const y=finiteMaybe(raw.year);if(y&&y>=2020&&y<=2100)out.year=Math.floor(y);
  for(const key of ['amount','contributionGoal','contributionActual']){const v=finiteMaybe(raw[key]);out[key]=v!==null&&v>=0?v:null;}
  for(const k of ['USD','EUR','JPY','USDT']){const v=finiteMaybe(raw.fx?.[k]);out.fx[k]=v!==null&&v>0?v:null;}
  for(const c of CATEGORIES.filter(x=>x.id!=='futures')){const v=finiteMaybe(raw.targets?.[c.id]);if(v!==null&&v>=0&&v<=100)out.targets[c.id]=v;}
  return out;
}
function readSaved(){
  try{const raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');state.holdings=Array.isArray(raw)?raw.map(normalizeHolding).filter(Boolean):[];}
  catch{state.holdings=[];msg('本機持倉讀取失敗。請檢查瀏覽器儲存設定或匯入備份。','error');}
  try{state.goals=normalizeGoals(JSON.parse(localStorage.getItem(GOAL_KEY)||'null'));}
  catch{state.goals=defaultGoals();msg('目標設定讀取失敗，請重新設定或匯入備份。','error');}
}
function persist(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state.holdings));localStorage.setItem(GOAL_KEY,JSON.stringify(state.goals));$('lastSaved').textContent='本機已儲存 · '+localTime();return true;}
  catch{msg('資料儲存失敗，請先匯出 JSON 備份，確認瀏覽器是否允許本機儲存。','error');return false;}
}
function quoteFor(h){const q=state.quotes[h.market+':'+h.symbol];return q&&Number.isFinite(Number(q.price))&&Number(q.price)>0?q:null;}
// 當前使用來源：自動參考匯率優先；老版本手填值只在無自動資料時備援。
function autoFxRate(ccy){
 if(ccy==='TWD')return 1;
 const fiat=state.fxAuto.fiat;
 if(!fiat||!fiat.fetchedAt||Date.now()-fiat.fetchedAt>FX_STALE_LIMIT)return null;
 if(ccy==='USDT'){
  const usdt=state.fxAuto.usdt;
  return usdt&&usdt.usd>0&&usdt.fetchedAt&&Date.now()-usdt.fetchedAt<=FX_STALE_LIMIT?fiat.rates.USD*usdt.usd:null;
 }
 return fiat.rates[ccy]||null;
}
function fxRate(ccy){if(ccy==='TWD')return 1;const automatic=autoFxRate(ccy);if(automatic)return automatic;const manual=state.goals.fx[ccy];return manual&&manual>0?manual:null;}
function loadFxCache(){
 try{
  const raw=JSON.parse(localStorage.getItem(FX_CACHE_KEY)||'{}');
  if(raw.fiat&&['USD','EUR','JPY'].every(c=>Number.isFinite(Number(raw.fiat.rates?.[c]))&&Number(raw.fiat.rates[c])>0)&&Number.isFinite(raw.fiat.fetchedAt))state.fxAuto.fiat=raw.fiat;
  if(raw.usdt&&Number(raw.usdt.usd)>0&&Number.isFinite(raw.usdt.fetchedAt))state.fxAuto.usdt=raw.usdt;
 }catch{/* 快取損毀不應阻止持倉顯示 */}
}
function cacheFx(){try{localStorage.setItem(FX_CACHE_KEY,JSON.stringify(state.fxAuto));}catch{/* 快取儲存失敗時本次頁面仍可使用 */}}
function fxTime(t){return t?new Date(t).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'日期未知';}
function fxDisplayValue(v){return v===null?'':String(Number(v.toPrecision(8)));}
function renderFxFields(){
 const missing=[],fromManual=[];
 for(const c of ['USD','EUR','JPY','USDT']){
  const input=$('fx'+c),auto=autoFxRate(c),manual=state.goals.fx[c];
  input.readOnly=auto!==null;
  input.value=auto!==null?fxDisplayValue(auto):(manual??'');
  input.title=auto!==null?'已自動讀取，隨市場參考匯率更新':(manual?'自動服務暫無資料，沿用舊手動匯率':'自動來源無法取得，可以手動填入備援匯率');
  input.placeholder=auto!==null?'已取得自動匯率':'尚無匯率，可手動備援';
  if(auto===null){if(manual)fromManual.push(c);else missing.push(c);}
 }
 const fiat=state.fxAuto.fiat,usdt=state.fxAuto.usdt;
 const fiatAge=fiat?Date.now()-fiat.fetchedAt:Infinity;
 const usdtAge=usdt?Date.now()-usdt.fetchedAt:Infinity;
 const parts=[];
 if(state.fxLoading)parts.push('正在查詢匯率…');
 if(fiat)parts.push('法幣資料 '+fxTime(fiat.sourceUpdatedAt)+'（'+(fiatAge>FX_FIAT_MAX_AGE?'快取／可能過期':'已取得')+'）');
 if(usdt)parts.push('USDT 資料 '+fxTime(usdt.sourceUpdatedAt)+'（'+(usdtAge>FX_USDT_MAX_AGE?'快取／可能過期':'已取得')+'）');
 if(fromManual.length)parts.push(fromManual.join('、')+'：舊手動值備援');
 if(missing.length)parts.push(missing.join('、')+'：尚無有效匯率');
 if(state.fxErrors.length)parts.push('查詢問題：'+state.fxErrors.join('；'));
 $('fxStatus').textContent=parts.join('｜')||'準備取得自動參考匯率…';
 $('refreshFx').disabled=state.fxLoading;
}
async function fetchJsonWithTimeout(url){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);return await response.json();}
 finally{clearTimeout(timer);}
}
async function refreshFx(force=false){
 if(state.fxLoading)return;
 const now=Date.now();
 const fiatDue=!state.fxAuto.fiat||now-state.fxAuto.fiat.fetchedAt>(force?60*60*1000:FX_FIAT_MAX_AGE);
 const usdtDue=!state.fxAuto.usdt||now-state.fxAuto.usdt.fetchedAt>(force?60*1000:FX_USDT_MAX_AGE);
 if(!fiatDue&&!usdtDue){renderFxFields();render();return;}
 state.fxLoading=true;state.fxErrors=[];renderFxFields();
 const tasks=[];
 if(fiatDue)tasks.push((async()=>{
  const data=await fetchJsonWithTimeout('https://open.er-api.com/v6/latest/USD');
  const r=data.rates||{};
  if(data.result!=='success'||data.base_code!=='USD'||!['USD','EUR','JPY','TWD'].every(c=>Number.isFinite(Number(r[c]))&&Number(r[c])>0))throw Error('法幣資料格式異常');
  const next={USD:Number(r.TWD),EUR:Number(r.TWD)/Number(r.EUR),JPY:Number(r.TWD)/Number(r.JPY)};
  state.fxAuto.fiat={rates:next,fetchedAt:Date.now(),sourceUpdatedAt:Number(data.time_last_update_unix)*1000||Date.now()};
 })().catch(e=>state.fxErrors.push('法幣 '+(e.name==='AbortError'?'逾時':e.message))));
 if(usdtDue)tasks.push((async()=>{
  const data=await fetchJsonWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd&include_last_updated_at=true');
  const price=Number(data.tether?.usd);
  if(!Number.isFinite(price)||price<=0)throw Error('USDT 報價格式異常');
  state.fxAuto.usdt={usd:price,fetchedAt:Date.now(),sourceUpdatedAt:Number(data.tether?.last_updated_at)*1000||Date.now()};
 })().catch(e=>state.fxErrors.push('USDT '+(e.name==='AbortError'?'逾時':e.message))));
 await Promise.all(tasks);
 state.fxLoading=false;cacheFx();renderFxFields();render();
}

function evaluate(h){
  const q=h.market!=='MANUAL'?quoteFor(h):null;
  const price=h.category==='cash'?1:(h.market==='MANUAL'?h.manualPrice:(q?Number(q.price):null));
  const fx=fxRate(h.currency);
  const valid=price!==null&&Number.isFinite(price)&&price>0&&fx!==null;
  const result={h,price,quote:q,fx,valid,reason:price===null||price<=0?'缺少報價':fx===null?'缺少匯率':'',value:null,pnl:null,exposure:null};
  if(valid&&h.category==='futures'){
    result.pnl=(price-h.cost)*h.quantity*h.multiplier*fx*(h.direction==='short'?-1:1);
    result.exposure=price*h.quantity*h.multiplier*fx;
  }else if(valid){result.value=h.quantity*price*fx;result.pnl=h.category==='cash'?0:h.quantity*(price-h.cost)*fx;}
  return result;
}
function aggregate(){
  const all=state.holdings.map(evaluate);
  const valued=all.filter(x=>x.h.category!=='futures'&&x.valid);
  const total=valued.reduce((sum,x)=>sum+x.value,0);
  const pnl=valued.reduce((sum,x)=>sum+x.pnl,0);
  const groups=Object.fromEntries(CATEGORIES.map(c=>[c.id,{count:0,value:0,valid:0,unpriced:0}]));
  for(const x of all){const g=groups[x.h.category];g.count++;if(x.valid){g.valid++;if(x.h.category!=='futures')g.value+=x.value;}else g.unpriced++;}
  const exposure=all.filter(x=>x.h.category==='futures'&&x.valid).reduce((sum,x)=>sum+x.exposure,0);
  return {all,valued,total,pnl,groups,exposure,missing:all.filter(x=>!x.valid)};
}
function renderRow(x){
  const h=x.h,c=categoryById(h.category),shownName=h.name||x.quote?.name||h.symbol;
  const marketTag=h.market==='TWSE'?'上市':h.market==='TPEX'?'上櫃':'手動';
  const priceCell=x.price!==null&&x.price>0?`${currencyText(x.price,h.currency)}<small>${escapeHTML(x.quote?.date||'自行輸入')} · ${h.market==='MANUAL'?'手動':'收盤'}</small>`:'—<small>尚無有效報價</small>';
  const estimated=h.category==='futures'? (x.valid?`<b>${money(x.exposure)}</b><small>名目曝險，不列入總資產</small>`:'—'):(x.valid?`<b>${money(x.value)}</b>`:'—<small>'+escapeHTML(x.reason)+'</small>');
  const klass=x.pnl>0?'positive':x.pnl<0?'negative':'';
  const base=h.category==='futures'?h.quantity*h.multiplier*h.cost*Number(x.fx||0):h.quantity*h.cost*Number(x.fx||0);
  const pct=x.pnl!==null&&base>0?(h.category==='futures'?'':`<small class="${klass}">${x.pnl>0?'+':''}${number(x.pnl/base*100)}%</small>`):'';
  const pnl=x.pnl===null?'—':`<b class="${klass}">${x.pnl>0?'+':''}${money(x.pnl)}</b>${pct}`;
  return `<tr><td><span class="symbol-chip">${escapeHTML(c.short)} · ${escapeHTML(h.symbol||marketTag)}</span><span class="stock-name">${escapeHTML(shownName)}</span><small>${escapeHTML(marketTag)}${h.category==='futures'?' · '+(h.direction==='short'?'空單':'多單'):''}</small></td>
    <td><b>${number(h.quantity,6)}</b><small>${h.category==='futures'?'口':h.category==='cash'?'元／幣別單位':'股／單位'}</small></td>
    <td>${h.category==='cash'?'—':currencyText(h.cost,h.currency)}${h.category==='futures'?'<small>合約乘數 '+number(h.multiplier)+'</small>':''}</td>
    <td>${priceCell}</td><td>${estimated}</td><td>${pnl}</td>
    <td class="right"><div class="row-actions"><button type="button" class="icon-button" data-action="edit" data-id="${escapeHTML(h.id)}">編輯</button><button type="button" class="icon-button danger" data-action="delete" data-id="${escapeHTML(h.id)}">刪除</button></div></td></tr>`;
}
function renderPie(agg){
 const active=CATEGORIES.filter(c=>c.id!=='futures'&&agg.groups[c.id].value>0);
 let sum=0;
 const arcs=active.map(c=>{const start=sum/agg.total*100;sum+=agg.groups[c.id].value;const end=sum/agg.total*100;return `${c.color} ${start.toFixed(5)}% ${end.toFixed(5)}%`;});
 $('allocationPie').style.background=active.length?`conic-gradient(${arcs.join(',')})`:'#e7edf2';
 $('pieTotal').textContent=money(agg.total);
 $('allocationLegend').innerHTML=active.length?active.map(c=>`<div class="legend-line"><span class="legend-dot" style="background:${c.color}"></span><b>${escapeHTML(c.name)}</b><span>${number(agg.groups[c.id].value/agg.total*100)}%</span><small>${money(agg.groups[c.id].value)}</small></div>`).join(''):'<p class="muted">新增資產後自動產生分類占比。</p>';
}
function renderCategories(agg){
 $('categoryCards').innerHTML=CATEGORIES.map(c=>{
   const g=agg.groups[c.id],isFuture=c.id==='futures';
   const val=isFuture?agg.exposure:g.value;
   return `<article class="category-tile"><div class="cat-head"><span class="cat-dot" style="background:${c.color}"></span><b>${escapeHTML(c.name)}</b><span>${g.count} 筆</span></div><strong>${money(val)}</strong><small>${isFuture?'名目曝險（不納入資產）':agg.total?number(val/agg.total*100)+'% 資產配置':'未計算比例'}${g.unpriced?' · '+g.unpriced+' 筆缺報價／匯率':''}</small></article>`;
 }).join('');
}
function renderGoals(agg){
 const g=state.goals;$('targetYearLabel').textContent=g.year+' 年的資產累積目標';
 $('targetAmount').textContent=g.amount!==null?money(g.amount):'尚未設定';
 const progress=g.amount&&g.amount>0?agg.total/g.amount*100:null;
 $('progressValue').textContent=progress!==null?number(progress,1)+'%':'尚未設定';
 $('progressNote').textContent=progress!==null?'已估值資產占年底目標之比例':'請至下方設定年度資產目標';
 $('targetBar').style.width=(progress===null?0:Math.max(0,Math.min(100,progress)))+'%';
 $('targetHint').textContent=progress!==null?`${money(agg.total)} / ${money(g.amount)}${agg.missing.filter(x=>x.h.category!=='futures').length?'（部分資產尚未估值）':''}`:'沒有目標金額時無法計算達成率。';
 $('contributionGoalText').textContent=g.contributionGoal===null?'—':money(g.contributionGoal);
 $('contributionActualText').textContent=g.contributionActual===null?'—':money(g.contributionActual);
 const targets=CATEGORIES.filter(c=>c.id!=='futures'&&typeof g.targets[c.id]==='number');
 if(!targets.length){$('goalComparison').innerHTML='<p class="muted">尚未設定分類配置目標。</p>';return;}
 $('goalComparison').innerHTML=targets.map(c=>{
   const curr=agg.total>0?agg.groups[c.id].value/agg.total*100:null,target=g.targets[c.id],delta=curr===null?null:curr-target;
   const deltaClass=delta===null?'':Math.abs(delta)>5?'drift':'aligned';
   const deltaText=delta===null?'無法計算':(delta>0?'+':'')+number(delta,1)+' 個百分點';
   return `<div class="comparison-line"><div><b>${escapeHTML(c.name)}</b><small>目標 ${number(target)}%</small></div><div class="comparison-meter"><span style="background:${c.color};width:${Math.max(0,Math.min(100,curr||0))}%"></span></div><div class="comparison-result"><b>${curr===null?'—':number(curr,1)+'%'}</b><small class="${deltaClass}">${deltaText}</small></div></div>`;
 }).join('')+'<p class="muted compare-foot">差距只是與自行設定比例的比較，不代表必須立即買進或賣出。預設以 ±5 個百分點作提醒。</p>';
}
/**
 * 新資金補足配置的試算器：僅針對已估值的非期貨資產。
 * 投入上限為輸入的新資金金額，對低於「投入後總資產 × 目標比例」的類別依缺口分配。
 * 不挑選／買進具體金融商品，不保證未來績效，也不會下單。
 */
function computeContributionPlan(agg, budget, targets) {
 const eligible=CATEGORIES.filter(c=>c.id!=='futures');
 const goalTotal=eligible.reduce((n,c)=>n+(Number(targets[c.id])||0),0);
 if(Math.abs(goalTotal-100)>0.01)return {error:'請先到「年度目標」，將各類資產的目標比例設定為合計 100%，再儲存。'};
 if(!Number.isFinite(budget)||budget<1||budget>1e12)return {error:'請輸入大於 0、且不超過 NT$1 兆的本次投入金額。'};
 if(agg.missing.some(x=>x.h.category!=='futures'))return {error:'有持倉缺少有效股價或匯率。請先補齊，避免以不完整資產計算買進配置。'};
 const postTotal=agg.total+budget;
 const items=eligible.map(c=>({
    category:c, current:agg.groups[c.id].value, target:Number(targets[c.id])||0,
    shortfall:Math.max(0,(Number(targets[c.id])||0)/100*postTotal-agg.groups[c.id].value)
 })).filter(x=>x.target>0&&x.shortfall>0.0001);
 const shortfallTotal=items.reduce((sum,x)=>sum+x.shortfall,0);
 if(!shortfallTotal)return {error:'目前沒有低於目標的分類；請確認設定的比例是否符合你的風險承受度。'};
 // 最大餘數法：使分配至各類別的整數元加總等於預算。
 const budgetWhole=Math.floor(budget);
 const base=items.map(x=>({ ...x, exact:budgetWhole*x.shortfall/shortfallTotal }));
 for(const x of base){x.suggested=Math.floor(x.exact);x.fraction=x.exact-x.suggested;}
 let remainder=budgetWhole-base.reduce((sum,x)=>sum+x.suggested,0);
 for(const x of [...base].sort((a,b)=>b.fraction-a.fraction).slice(0,remainder))x.suggested++;
 return {budget:budgetWhole,postTotal,items:base.filter(x=>x.suggested>0).sort((a,b)=>b.suggested-a.suggested)};
}
const categoryStudyTip={
 tw:'可研究分散型台股 ETF 的持股範圍、費用與追蹤指數；不要只看近期漲幅。',
 us:'可研究低成本、多元化的美股 ETF／基金，並考量匯率與海外交易成本。',
 fund:'先比較基金投資範圍、管理費、重複持股及申購／贖回限制。',
 crypto:'加密資產波動及損失風險高；即使目標比例不足，也不代表適合直接加碼。',
 bond:'可研究分散型債券基金／ETF，並評估存續期間、利率及信用風險。',
 cash:'這筆可留作現金／緊急預備金，無須為了達成比例而買入商品。',
 other:'先確認這一類資產的流動性、估值依據及是否適合增加。'
};
function renderAdvice(agg){
 const summary=$('adviceSummary'),cards=$('adviceCards'),cautions=$('adviceCautions');
 if(!summary)return;
 const budget=finiteMaybe($('adviceBudget').value);
 const plan=computeContributionPlan(agg,budget,state.goals.targets);
 cards.innerHTML='';cautions.innerHTML='';
 if(plan.error){summary.textContent=plan.error;summary.className='advice-summary advice-needs-setup';return;}
 const remaining=state.goals.amount===null?null:Math.max(0,state.goals.amount-plan.postTotal);
 summary.className='advice-summary';
 summary.innerHTML=`<div><small>本次新增資金</small><strong>${money(plan.budget)}</strong></div><div><small>投入後估計資產（假設價格不變）</small><strong>${money(plan.postTotal)}</strong></div><div><small>距年底資產目標</small><strong>${remaining===null?'尚未設定':money(remaining)}</strong></div>`;
 cards.innerHTML=plan.items.map(x=>{
  const existing=agg.all.filter(z=>z.h.category===x.category.id&&z.valid).slice(0,3);
  const examples=existing.length?`<p class="advice-existing">目前已持有：${existing.map(z=>escapeHTML(z.h.name||z.quote?.name||z.h.symbol)).join('、')}（僅供檢視，非推薦加碼）</p>`:'<p class="advice-existing">目前未持有這一類；先研究適合自身風險與費用需求的工具。</p>';
  return `<article class="advice-tile"><div class="advice-tile-top"><span class="cat-dot" style="background:${x.category.color}"></span><b>${escapeHTML(x.category.name)}</b><span>目標 ${number(x.target,1)}%</span></div>
    <div class="advice-tile-amount">${x.category.id==='cash'?'建議預留':'可評估投入'} <strong>${money(x.suggested)}</strong></div>
    <p class="advice-tile-detail">目前 ${money(x.current)} · 相對投入後目標缺口 ${money(x.shortfall)} · 試算後占比 ${number((x.current+x.suggested)/plan.postTotal*100,1)}%</p>
    <div class="advice-tile-bar"><span style="width:${Math.min(100,plan.budget?x.suggested/plan.budget*100:0)}%;background:${x.category.color}"></span></div>
    <p class="advice-study">${escapeHTML(categoryStudyTip[x.category.id]||categoryStudyTip.other)}</p>${examples}</article>`;
 }).join('');
 const notes=['這是依你自訂目標比例的分配試算，不是個別股票、基金、期貨或虛擬資產的買入訊號；網站不會替你下單。'];
 if(agg.all.some(x=>x.h.category==='futures'))notes.push('期貨名目曝險與保證金未納入資產圓餅圖；試算前應另外檢查槓桿與資金風險。');
 if(plan.items.some(x=>x.category.id==='crypto'))notes.push('加密貨幣價格可能劇烈波動，不能因分類低於目標就視為適合加碼。');
 if(state.goals.amount!==null)notes.push('距目標差距僅是現值與投入額的算術比較，不代表年度目標一定能達成。');
 cautions.innerHTML=notes.map(t=>`<p>${escapeHTML(t)}</p>`).join('');
}
function render(){
 const agg=aggregate();const priced=agg.valued.length,assetCount=agg.all.filter(x=>x.h.category!=='futures').length;
 $('totalValue').textContent=priced?money(agg.total):assetCount?'尚無可估值資產':'NT$ 0';
 $('totalPnl').textContent=priced?(agg.pnl>0?'+':'')+money(agg.pnl):'—';
 $('totalPnl').className='stat-number '+(agg.pnl>0?'positive':agg.pnl<0?'negative':'');
 $('totalNote').textContent=`${priced}/${assetCount} 筆非期貨資產已有估值${agg.missing.length?' · 有未估值項目':''}`;
 $('pnlNote').textContent='依買進成本估算；不含期貨、手續費與稅務';
 $('holdingCount').innerHTML=number(agg.all.length,0)+' <span class="stat-unit">筆</span>';
 $('holdingCountNote').textContent=CATEGORIES.filter(c=>agg.groups[c.id].count).length+' 種資產類別';
 const filter=$('categoryFilter').value;
 const rows=agg.all.filter(x=>filter==='all'||x.h.category===filter);
 $('holdingsBody').innerHTML=rows.length?rows.map(renderRow).join(''):`<tr><td colspan="7" class="empty-cell"><b>${agg.all.length?'這個分類目前沒有資產':'尚未新增任何資產'}</b><div style="margin-top:6px;font-size:12px">點右上角「＋ 新增資產」，可選台股、美股、基金、期貨、加密貨幣等分類。</div></td></tr>`;
 $('filteredCount').textContent=rows.length+' 筆';
 $('missingNote').textContent=agg.missing.length?`${agg.missing.length} 筆缺少報價或匯率，未以 0 元計入`: '台股：臺灣證券交易所／櫃買中心官方盤後行情';
 const dot=$('quoteDot');dot.className='status-dot '+(state.priceLoading?'':state.priceError?'error':Object.keys(state.quotes).length?'ready':'');
 const statuses=Object.entries(state.markets).filter(([,v])=>v&&v.date).map(([k,v])=>(k==='TWSE'?'上市':'上櫃')+' '+v.date);
 $('quoteStatus').textContent=state.priceLoading?'正在取得官方行情…':state.priceError?'台股報價讀取失敗':statuses.length?'台股行情 · '+statuses.join(' / '):'尚未下載台股報價';
 renderPie(agg);renderCategories(agg);renderGoals(agg);renderAdvice(agg);previewPrice();
}
function parseQuotes(data){
 if(!data||typeof data!=='object'||!data.quotes||typeof data.quotes!=='object')throw Error('行情檔格式不正確');
 const entries=Object.entries(data.quotes).filter(([k,v])=>/^(TWSE|TPEX):[0-9A-Z]{4,12}$/.test(k)&&v&&Number(v.price)>0&&Number.isFinite(Number(v.price)));
 return {quotes:Object.fromEntries(entries),markets:data.markets||{},generatedAt:data.generatedAt||null};
}
async function refreshQuotes(){
 if(state.priceLoading)return;state.priceLoading=true;state.priceError='';$('refreshQuotes').disabled=true;render();
 try{const res=await fetch(`./quotes/market.json?update=${Date.now()}`,{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);
  const result=parseQuotes(await res.json());if(!Object.keys(result.quotes).length)throw Error('無可用台股報價');
  state.quotes=result.quotes;state.markets=result.markets;state.generatedAt=result.generatedAt;
  if(Object.values(result.markets).some(x=>x?.error))msg('部分交易所本次未能更新，仍顯示最後取得的收盤報價，請注意日期。');else msg('');
 }catch(e){state.priceError=e.message||String(e);msg('台股行情載入失敗，請確認 quotes/market.json 已由 Python 或 GitHub Actions 更新；其他手動記錄仍保留。','error');}
 finally{state.priceLoading=false;$('refreshQuotes').disabled=false;render();}
}
function updateFormFields(){
 const c=$('category').value,market=$('market'),isCash=c==='cash',isFuture=c==='futures',isAuto=market.value!=='MANUAL';
 if(isFuture||isCash||!['tw','fund','bond','other'].includes(c))market.value='MANUAL';
 document.querySelectorAll('.futures-only').forEach(el=>el.hidden=!isFuture);
 market.disabled=isFuture||isCash||!['tw','fund','bond','other'].includes(c);
 $('manualPriceField').hidden=market.value!=='MANUAL'||isCash;
 $('currency').disabled=market.value!=='MANUAL';
 if(market.value!=='MANUAL')$('currency').value='TWD';
 if(isCash){$('cost').value=1;$('manualPrice').value=1;}
 $('quantityLabel').innerHTML=isCash?'現金金額（原幣） <em>*</em>':isFuture?'持有口數 <em>*</em>':'股數／單位數 <em>*</em>';
 $('cost').required=!isCash;
 if(c==='us'&&$('currency').value==='TWD'&&!state.editing)$('currency').value='USD';
 if(c==='crypto'&&$('currency').value==='TWD'&&!state.editing)$('currency').value='USD';
 $('previewPrice').textContent='';previewPrice();
}
function openDialog(item=null){
 $('holdingForm').reset();state.editing=item?item.id:null;$('formError').textContent='';$('dialogTitle').textContent=item?'編輯資產':'新增資產';
 $('holdingId').value=item?.id||'';$('category').value=item?.category||'tw';$('market').value=item?.market||'TWSE';
 $('symbol').value=item?.symbol||'';$('holdingName').value=item?.name||'';$('quantity').value=item?.quantity??'';
 $('cost').value=item?.cost??'';$('manualPrice').value=item?.manualPrice??'';$('currency').value=item?.currency||'TWD';
 $('multiplier').value=item?.multiplier??1;$('margin').value=item?.margin??'';$('direction').value=item?.direction||'long';
 updateFormFields();$('holdingDialog').showModal();$('category').focus();
}
function autoMarket(){
 const sym=$('symbol').value.trim().toUpperCase();if(!$('market').disabled&&['tw','fund','bond','other'].includes($('category').value)){
 const a=state.quotes['TWSE:'+sym],b=state.quotes['TPEX:'+sym];if(a&&!b)$('market').value='TWSE';else if(b&&!a)$('market').value='TPEX';
 }
 updateFormFields();
}
function previewPrice(){
 if(!$('symbol')||!$('previewPrice'))return;
 const category=$('category').value,market=$('market').value,sym=$('symbol').value.trim().toUpperCase();
 const q=state.quotes[market+':'+sym];const currency=$('currency').value;
 if(category==='cash'){$('previewPrice').textContent='現金面值';$('previewInfo').textContent='金額會依你設定的匯率換算成新台幣。';return;}
 if(market==='MANUAL'){
 const v=finiteMaybe($('manualPrice').value);$('previewPrice').textContent=v!==null&&v>0?currencyText(v,currency):'尚未輸入價格';
 $('previewInfo').textContent=category==='futures'?'期貨僅估算浮動損益及名目曝險，不納入資產配置。':'手動價格不會隨台股 Actions 自動更新。';return;
 }
 $('previewPrice').textContent=q&&Number(q.price)>0?currencyText(q.price,'TWD'):'暫無報價';
 $('previewInfo').textContent=q?`${q.date||'未知日期'} 收盤 · ${q.name||''}`:'請確認代號、上市上櫃市場或行情更新時間。';
}
function saveHolding(e){
 e.preventDefault();$('formError').textContent='';
 const c=$('category').value,isCash=c==='cash';
 const h=normalizeHolding({id:$('holdingId').value||createId(),category:c,market:$('market').value,name:$('holdingName').value,symbol:$('symbol').value,quantity:$('quantity').value,cost:isCash?1:$('cost').value,manualPrice:isCash?1:$('manualPrice').value,currency:$('currency').value,multiplier:$('multiplier').value,margin:$('margin').value,direction:$('direction').value});
 if(!h){$('formError').textContent='請填寫名稱或代號、正數數量、有效成本；期貨請填合約乘數。';return;}
 const same=state.holdings.some(x=>x.id!==h.id&&x.category===h.category&&x.market===h.market&&x.symbol===h.symbol&&x.symbol);
 if(same){$('formError').textContent='這筆標的已存在，請編輯原持倉。';return;}
 const old=state.holdings.findIndex(x=>x.id===h.id);if(old>=0)state.holdings[old]=h;else state.holdings.push(h);
 if(!persist())return;$('holdingDialog').close();render();
}
function tableAction(e){
 const btn=e.target.closest('button[data-action]');if(!btn)return;
 const h=state.holdings.find(x=>x.id===btn.dataset.id);if(!h)return;
 if(btn.dataset.action==='edit')openDialog(h);
 else if(confirm(`確定刪除「${h.name||h.symbol}」嗎？`)){state.holdings=state.holdings.filter(x=>x.id!==h.id);persist();render();}
}
function fillGoalForm(){
 const g=state.goals;for(const [field,key] of [['goalYear','year'],['goalAmount','amount'],['contributionGoal','contributionGoal'],['contributionActual','contributionActual']])$(field).value=g[key]??'';
 renderFxFields();
 for(const c of CATEGORIES.filter(x=>x.id!=='futures'))$('target_'+c.id).value=g.targets[c.id]??'';
}
function saveGoals(e){
 e.preventDefault();$('goalError').textContent='';
 const raw={year:$('goalYear').value,amount:$('goalAmount').value,contributionGoal:$('contributionGoal').value,contributionActual:$('contributionActual').value,fx:{},targets:{}};
 for(const c of ['USD','EUR','JPY','USDT'])raw.fx[c]=$('fx'+c).value;
 let sum=0,hasAny=false;
 for(const c of CATEGORIES.filter(x=>x.id!=='futures')){const v=$('target_'+c.id).value;if(v!==''){raw.targets[c.id]=v;sum+=Number(v);hasAny=true;}}
 if(hasAny&&Math.abs(sum-100)>.01){$('goalError').textContent=`配置比例合計 ${number(sum)}%，請調整為 100%（未填視為 0）。`;return;}
 if(Object.values(raw.fx).some(v=>v!==''&&(!(Number(v)>0)||!Number.isFinite(Number(v))))){$('goalError').textContent='填寫的匯率必須大於 0。';return;}
 if(!Number.isInteger(Number(raw.year))||Number(raw.year)<2020||Number(raw.year)>2100){$('goalError').textContent='目標年度需為 2020～2100。';return;}
 if(['amount','contributionGoal','contributionActual'].some(k=>raw[k]!==''&&(!(Number(raw[k])>=0)||!Number.isFinite(Number(raw[k]))))){$('goalError').textContent='目標金額與投入金額不能為負數。';return;}
 state.goals=normalizeGoals(raw);persist();render();renderFxFields();msg('已儲存年度目標與資產配置；匯率將依資料來源自動更新。');
}
function exportBackup(){
 const payload={format:'portfolio-ledger-v2',exportedAt:new Date().toISOString(),holdings:state.holdings,goals:state.goals};
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=`投資持倉與目標_${localDate()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importBackup(e){
 const f=e.target.files?.[0];e.target.value='';if(!f)return;
 try{if(f.size>4*1024*1024)throw Error('備份檔不能超過 4 MB');const doc=JSON.parse(await f.text());
  if(!['portfolio-ledger-v1','portfolio-ledger-v2'].includes(doc.format)||!Array.isArray(doc.holdings))throw Error('不支援的備份格式');
  if(doc.holdings.length>2000)throw Error('筆數過多');const items=doc.holdings.map(normalizeHolding);if(items.some(x=>!x))throw Error('備份中有格式不合法的資產');
  if(!confirm(`即將匯入 ${items.length} 筆資產並覆蓋目前 ${state.holdings.length} 筆資料。確定嗎？`))return;
  state.holdings=items;if(doc.format==='portfolio-ledger-v2')state.goals=normalizeGoals(doc.goals);
  persist();fillGoalForm();render();msg('備份匯入完成。');
 }catch(err){msg('匯入失敗：'+(err.message||String(err)),'error');}
}
function init(){
 for(const c of CATEGORIES){$('category').insertAdjacentHTML('beforeend',`<option value="${c.id}">${escapeHTML(c.name)}</option>`);$('categoryFilter').insertAdjacentHTML('beforeend',`<option value="${c.id}">${escapeHTML(c.name)}</option>`);}
 $('targetPercentInputs').innerHTML=CATEGORIES.filter(c=>c.id!=='futures').map(c=>`<label class="field"><span><i class="input-dot" style="background:${c.color}"></i>${escapeHTML(c.name)}（%）</span><input id="target_${c.id}" type="number" min="0" max="100" step="0.1" placeholder="選填"></label>`).join('');
 readSaved();loadFxCache();fillGoalForm();
 try{const saved=finiteMaybe(localStorage.getItem(ADVICE_BUDGET_KEY));if(saved!==null&&saved>=0&&saved<=1e12)$('adviceBudget').value=saved;}
 catch{/* storage blocked */}
 render();
 $('newHolding').addEventListener('click',()=>openDialog());$('refreshQuotes').addEventListener('click',refreshQuotes);
 $('categoryFilter').addEventListener('change',render);$('holdingsBody').addEventListener('click',tableAction);
 $('closeDialog').addEventListener('click',()=>$('holdingDialog').close());$('cancelDialog').addEventListener('click',()=>$('holdingDialog').close());
 $('holdingForm').addEventListener('submit',saveHolding);
 $('category').addEventListener('change',()=>{if($('category').value==='tw')$('market').value='TWSE';else $('market').value='MANUAL';updateFormFields();});
 $('market').addEventListener('change',updateFormFields);$('symbol').addEventListener('input',autoMarket);
 $('manualPrice').addEventListener('input',previewPrice);$('currency').addEventListener('change',previewPrice);
 $('goalForm').addEventListener('submit',saveGoals);$('refreshFx').addEventListener('click',()=>refreshFx(true));$('exportData').addEventListener('click',exportBackup);
 $('calculateAdvice').addEventListener('click',()=>{try{localStorage.setItem(ADVICE_BUDGET_KEY,$('adviceBudget').value);}catch{}renderAdvice(aggregate());});
 $('adviceBudget').addEventListener('change',()=>{try{localStorage.setItem(ADVICE_BUDGET_KEY,$('adviceBudget').value);}catch{}renderAdvice(aggregate());});
 $('importButton').addEventListener('click',()=>$('importFile').click());$('importFile').addEventListener('change',importBackup);
 refreshQuotes();refreshFx();
}
init();
