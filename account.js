'use strict';
// Supabase Free email/password auth + personal portfolio, protected by SQL RLS.
(() => {
  const $ = id => document.getElementById(id);
  const cfg = window.PORTFOLIO_SUPABASE_CONFIG;
  const configured = !!(cfg && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(cfg.url||'')) &&
    typeof cfg.publishableKey === 'string' && cfg.publishableKey.length > 20 && window.supabase?.createClient);
  const empty = () => ({holdings:[],goals:null,adviceBudget:'10000'});
  let client=null, user=null, ready=false, mode='login',seq=0, authStarted=false;
  let saveQueue=Promise.resolve(), recovery=false, busy=false, initialized=false;

  const cleanError = e => ({
    'invalid_credentials':'Email 或密碼不正確。',
    'email_not_confirmed':'請先完成信箱驗證。',
    'user_already_exists':'這個 Email 已經註冊。',
    'email_address_invalid':'Email 格式不正確。',
    'over_email_send_rate_limit':'郵件發送過於頻繁。',
    'PGRST116':'找不到使用者持倉。'
  })[e?.code] || (e?.message||String(e));
  function error(s='') {$('authError').textContent=s;$('authError').hidden=!s;}
  function info(s='') {$('authInfo').textContent=s;$('authInfo').hidden=!s;}
  function gate(show) {$('authGate').hidden=!show;document.body.classList.toggle('auth-open',show);}
  function lock(v) {document.body.classList.toggle('account-loading',v);}
  function updateBadge() {
    $('sidebarUserName').textContent=user?.email || '訪客模式';
    $('sidebarUserStatus').textContent=user?(ready?'我的雲端已同步':'私人資料載入中'):'資料僅在此瀏覽器';
    $('userAvatar').textContent=user?(user.email||'用').slice(0,1).toUpperCase():'訪';
    $('storageMode').textContent=user?(ready?'Supabase 私人雲端':'雲端尚未就緒'):'訪客本機儲存';
    $('openAccount').textContent=user?'帳號 / 登出':'登入';
    $('signOut').hidden=!user;$('authUserCard').hidden=!user;
    if(user)$('authUserCard').textContent='已登入：'+(user.email||'');
  }
  function setMode(next) {
    mode=next;error();info();
    const loggedIn=!!user;
    $('authForm').hidden=loggedIn && next!=='recovery';
    $('authLinks').hidden=loggedIn || next==='recovery';
    $('authTransfer').hidden=true;
    $('authPasswordWrap').hidden=next==='reset';$('authPassword').required=next!=='reset';
    $('authConfirmWrap').hidden=!['register','recovery'].includes(next);
    $('authConfirm').required=['register','recovery'].includes(next);
    $('switchRegister').hidden=next==='register';
    $('switchReset').hidden=next==='reset';
    $('switchLogin').hidden=next==='login';
    $('authSubmit').textContent=({register:'註冊新帳號',reset:'寄出密碼重設信',recovery:'設定新密碼',login:'登入'})[next];
    $('authPassword').autocomplete=['register','recovery'].includes(next)?'new-password':'current-password';
    $('authHeading').textContent=({register:'註冊新帳號',reset:'忘記密碼',recovery:'設定新密碼',login:'登入持倉日誌'})[next];
    $('authLead').textContent=({
      register:'Email＋密碼建立私人帳號；若啟用信箱驗證，需從確認信完成註冊。',
      reset:'輸入註冊信箱，我們會要求 Supabase 寄送密碼重設連結（公開寄信需設定 SMTP）。',
      recovery:'請輸入新密碼並確認，完成後即可繼續使用。',
      login:'登入後，僅載入你自己的資產持倉與年度目標。'
    })[next];
  }
  function hasVisitorData(){
    const x=window.PortfolioApp.visitorSnapshot();
    return x.holdings.length>0 || !!(x.goals&&(x.goals.amount!=null||Object.keys(x.goals.targets||{}).length));
  }
  function showGuest(showLogin=false){
    user=null;ready=false;++seq;
    window.PortfolioApp.restoreVisitor();updateBadge();setMode('login');
    lock(false);gate(showLogin);
  }
  // Never automatically import local guest positions into a newly logged-in account.
  function migration(){
    setMode('login');$('authForm').hidden=true;$('authLinks').hidden=true;
    $('authTransfer').hidden=false;$('authHeading').textContent='首次登入：建立私人雲端';
    $('authLead').textContent='可將目前訪客持倉複製到這個帳號；建議先匯出 JSON 備份。';
    lock(true);gate(true);
  }
  async function handleSession(next) {
    const ticket=++seq;const nextUID=next?.id||null;
    if(!nextUID){const showWelcome=!initialized;initialized=true;showGuest(showWelcome);return;}
    initialized=true;
    if(user?.id===nextUID && ready){updateBadge();return;}
    user=next;ready=false;updateBadge();
    // Immediately purge previous user's in-memory positions before fetching the next profile.
    window.PortfolioApp.loadProfile(empty());lock(true);gate(true);
    try {
      const {data, error:e}=await client.from('user_portfolios')
        .select('holdings,goals,advice_budget').eq('user_id',nextUID).maybeSingle();
      if(e)throw e;
      if(ticket!==seq || user?.id!==nextUID)return;
      if(data){window.PortfolioApp.loadProfile({holdings:data.holdings,goals:data.goals,adviceBudget:data.advice_budget});
        ready=true;lock(false);gate(false);
      }else if(hasVisitorData())migration();
      else{
        window.PortfolioApp.loadProfile(empty());ready=true;
        await saveProfile(window.PortfolioApp.snapshot());
        if(ticket!==seq)return;
        lock(false);gate(false);
      }
      updateBadge();
    }catch(e){
      if(ticket!==seq)return;
      ready=false;window.PortfolioApp.loadProfile(empty());lock(true);gate(true);
      error('私人資料庫無法讀取：'+cleanError(e)+'。請確認 SQL 安全規則。');updateBadge();
    }
  }
  async function saveProfile(payload){
    if(!user || !ready)return Promise.reject(Error('尚未完成私人資料讀取'));
    const uid=user.id;
    const data=JSON.parse(JSON.stringify(payload));
    $('lastSaved').textContent='私人雲端儲存中…';
    saveQueue=saveQueue.catch(()=>{}).then(async()=>{
      if(!ready || user?.id!==uid)throw Error('帳號已切換，取消上一個帳號的寫入');
      const {error:e}=await client.from('user_portfolios').upsert({
        user_id:uid,holdings:data.holdings,goals:data.goals || {},
        advice_budget:String(data.adviceBudget??''),updated_at:new Date().toISOString()
      },{onConflict:'user_id'});
      if(e)throw e;
      if(user?.id===uid)$('lastSaved').textContent='私人雲端已同步 · '+new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
    }).catch(e=>{if(user?.id===uid){gate(true);lock(true);error('雲端儲存失敗（未確認保存）：'+cleanError(e));}throw e;});
    saveQueue.catch(()=>{});
    return saveQueue;
  }
  window.PortfolioAccount={isSignedIn:()=>!!user,canWrite:()=>!!user&&ready,saveProfile};
  async function submit(e){
    e.preventDefault();if(busy)return;error();info();
    if(!configured){error('尚未完成 Supabase 免費專案設定。請先設定 Project URL 與 publishable key。');return;}
    const email=$('authEmail').value.trim(),pw=$('authPassword').value;
    busy=true;$('authSubmit').disabled=true;
    try{
      if(mode==='reset'){
        const {error:e}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
        if(e)throw e;
        info('如果帳號存在且寄信服務已設定，將收到密碼重設連結。請查看收件匣及垃圾郵件。');
      }else if(mode==='register'){
        if(pw.length<8)throw Error('密碼至少 8 個字元。');
        if(pw!==$('authConfirm').value)throw Error('兩次密碼不同。');
        const {data,error:e}=await client.auth.signUp({email,password:pw,options:{emailRedirectTo:location.origin+location.pathname}});
        if(e)throw e;
        if(!data?.session){setMode('login');info('已送出註冊要求。如果你啟用了信箱驗證，請先確認電子郵件再登入。公開寄信須設定 SMTP。');}
        else{info('帳號建立成功，正在載入專屬雲端資料。');}
      }else if(mode==='recovery'){
        if(pw.length<8||pw!==$('authConfirm').value)throw Error('新密碼須至少 8 個字元，且兩次輸入一致。');
        const {error:e}=await client.auth.updateUser({password:pw});if(e)throw e;
        recovery=false;setMode('login');info('密碼已更新。');
        const {data}=await client.auth.getUser();
        if(ready && user?.id===data?.user?.id){lock(false);gate(false);updateBadge();}
        else await handleSession(data?.user||null);
      }else{
        const {error:e}=await client.auth.signInWithPassword({email,password:pw});if(e)throw e;
        info('登入成功，正在讀取你的私人雲端資料。');
      }
    }catch(ex){error(cleanError(ex));}
    finally{busy=false;$('authSubmit').disabled=false;$('authPassword').value='';$('authConfirm').value='';}
  }
  async function transfer(copy){
    if(!user)return;
    const ticket=seq, data=copy?window.PortfolioApp.visitorSnapshot():empty();
    $('migrateGuest').disabled=true;$('startCloudFresh').disabled=true;
    error();
    try{
      window.PortfolioApp.loadProfile(data);ready=true;
      await saveProfile(window.PortfolioApp.snapshot());
      if(ticket!==seq)return;
      if(copy)window.PortfolioApp.clearVisitorData();
      lock(false);gate(false);updateBadge();
    }catch(e){ready=false;window.PortfolioApp.loadProfile(empty());migration();error('首次建立雲端資料失敗：'+cleanError(e));}
    finally{$('migrateGuest').disabled=false;$('startCloudFresh').disabled=false;}
  }
  async function signOut(){
    try{await saveQueue.catch(()=>{});
      if(client){const {error:e}=await client.auth.signOut();if(e)throw e;}
      showGuest(true);
    }catch(e){error('登出失敗：'+cleanError(e));}
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    $('openAccount').addEventListener('click',()=>{
      error();info();gate(true);
      if(!user)setMode('login');
      else if(!ready)migration();
      else{$('authForm').hidden=true;$('authLinks').hidden=true;
        $('authHeading').textContent='我的私人雲端';$('authLead').textContent='資料只屬於這個帳號，可用其他裝置登入查看。';}
    });
    $('closeAuth').addEventListener('click',()=>{if(!user||ready)gate(false);else error('私人持倉還在載入中。請登出或完成初始化。');});
    $('guestContinue').addEventListener('click',async()=>{if(user)await signOut();lock(false);gate(false);});
    $('switchRegister').addEventListener('click',()=>setMode('register'));
    $('switchReset').addEventListener('click',()=>setMode('reset'));
    $('switchLogin').addEventListener('click',()=>setMode('login'));
    $('authForm').addEventListener('submit',submit);
    $('signOut').addEventListener('click',signOut);
    $('migrateGuest').addEventListener('click',()=>transfer(true));
    $('startCloudFresh').addEventListener('click',()=>transfer(false));
    setMode('login');updateBadge();gate(true);
    if(!configured){$('authSetupNote').textContent='Supabase 尚未設定。現在可用訪客模式試用；Email 登入與雲端同步暫不可使用。';
      $('authSubmit').disabled=true;lock(false);return;}
    $('authSetupNote').textContent='私人雲端使用 Supabase Free。公開寄送信箱驗證及重設密碼信需要設定自己的 SMTP。';
    try{
      client=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      client.auth.onAuthStateChange((event,session)=>{
        if(event==='PASSWORD_RECOVERY'){
          recovery=true;setMode('recovery');gate(true);lock(true);return;
        }
        // Delay DB calls until after auth SDK callback exits.
        if(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','TOKEN_REFRESHED','USER_UPDATED'].includes(event)){
          queueMicrotask(()=>{
            if(recovery)return;
            handleSession(session?.user||null);
          });
        }
      });
      authStarted=true;
    }catch(e){error('初始化 Supabase 失敗：'+cleanError(e));lock(false);}
  });
})();
