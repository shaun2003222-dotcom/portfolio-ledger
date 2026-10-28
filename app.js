'use strict';
/* v2 keeps the original holdings storage key to preserve all previously entered TWSE/TPEX positions. */
const STORAGE_KEY = 'portfolio-ledger-holdings-v1';
const GOAL_KEY = 'portfolio-ledger-goals-v2';
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
const state = {holdings:[],goals:defaultGoals(),quotes:{},markets:{},generatedAt:null,priceLoading:false,priceError:'',editing:null};
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
function fxRate(ccy){if(ccy==='TWD')return 1;const v=state.goals.fx[ccy];return v&&v>0?v:null;}
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
 renderPie(agg);renderCategories(agg);renderGoals(agg);previewPrice();
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
 for(const c of ['USD','EUR','JPY','USDT'])$('fx'+c).value=g.fx[c]??'';
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
 state.goals=normalizeGoals(raw);persist();render();msg('已儲存年度目標、分類配置及自訂匯率。');
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
 readSaved();fillGoalForm();render();
 $('newHolding').addEventListener('click',()=>openDialog());$('refreshQuotes').addEventListener('click',refreshQuotes);
 $('categoryFilter').addEventListener('change',render);$('holdingsBody').addEventListener('click',tableAction);
 $('closeDialog').addEventListener('click',()=>$('holdingDialog').close());$('cancelDialog').addEventListener('click',()=>$('holdingDialog').close());
 $('holdingForm').addEventListener('submit',saveHolding);
 $('category').addEventListener('change',()=>{if($('category').value==='tw')$('market').value='TWSE';else $('market').value='MANUAL';updateFormFields();});
 $('market').addEventListener('change',updateFormFields);$('symbol').addEventListener('input',autoMarket);
 $('manualPrice').addEventListener('input',previewPrice);$('currency').addEventListener('change',previewPrice);
 $('goalForm').addEventListener('submit',saveGoals);$('exportData').addEventListener('click',exportBackup);
 $('importButton').addEventListener('click',()=>$('importFile').click());$('importFile').addEventListener('change',importBackup);
 refreshQuotes();
}
init();
