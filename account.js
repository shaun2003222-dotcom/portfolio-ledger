'use strict';
/* Genuine Google login / optional Firestore sync; guest mode needs no configuration. */
(() => {
  const $ = id => document.getElementById(id);
  const config = window.PORTFOLIO_FIREBASE_CONFIG;
  const configured = !!(config && typeof config === 'object' && typeof config.apiKey === 'string' &&
    config.apiKey.length > 15 && !config.apiKey.includes('你自己的') &&
    typeof config.projectId === 'string' && config.projectId.length > 3 &&
    typeof config.authDomain === 'string' && typeof config.appId === 'string' &&
    typeof window.firebase !== 'undefined' && firebase.auth && firebase.firestore);
  let auth = null, db = null, user = null, canWrite = false, saveSerial = Promise.resolve();
  let switching = 0;

  function showError(message) {
    $('authError').textContent = message;
    $('authError').hidden = !message;
  }
  function showGate() { $('authGate').hidden = false; document.body.classList.add('auth-open'); }
  function hideGate() {
    $('authGate').hidden = true;document.body.classList.remove('auth-open');
    try { sessionStorage.setItem('portfolio-login-screen-seen-v1','1'); } catch {}
  }
  function wasSeen() {try{return !!wasSeen();}catch{return false;}}
  function hasVisitorData() {
    const data=window.PortfolioApp.visitorSnapshot();
    return data.holdings.length > 0 || (data.goals && (data.goals.amount != null || Object.keys(data.goals.targets||{}).length));
  }
  function setLoading(value) { document.body.classList.toggle('account-loading', value); }
  function updateBadge() {
    $('sidebarUserName').textContent = user ? (user.displayName || user.email || '已登入') : '訪客模式';
    $('sidebarUserStatus').textContent = user ? (canWrite ? '個人雲端已連線' : '正在讀取私人資料') : '資料僅存於此瀏覽器';
    $('userAvatar').textContent = user ? (user.displayName || user.email || '用').trim().slice(0,1) : '訪';
    $('storageMode').textContent = user ? (canWrite ? 'Google 私人雲端儲存' : '雲端資料載入中') : '訪客本機儲存';
    $('openAccount').textContent = user ? '帳號' : '登入';
    $('googleLogin').hidden = !!user;
    $('signOut').hidden = !user;
    $('guestContinue').hidden = !!user;
    $('authHeading').textContent = user ? '你的 Google 帳號' : '登入持倉日誌';
    $('authLead').textContent = user ? '持倉、年度目標與下一筆投入預算會儲存到你的私人 Firestore 資料。' :
      '使用 Google 登入同步私人資料；也可以直接訪客試用。';
    $('authUserCard').hidden = !user;
    if (user) $('authUserCard').textContent = `已登入：${user.displayName || 'Google 帳號'} · ${user.email || ''}`;
  }
  function cloudPath(uid) {return db.collection('users').doc(uid).collection('portfolios').doc('default');}
  function resetForVisitor() {
    user = null; canWrite = false; switching++;
    window.PortfolioApp.restoreVisitor();
    setLoading(false); $('authTransfer').hidden = true;
    updateBadge();
  }
  async function onUserChanged(nextUser) {
    const seq = ++switching;
    user = nextUser; canWrite = false;
    updateBadge();
    if (!user) {
      resetForVisitor();
      if (!wasSeen()) showGate();
      return;
    }
    setLoading(true);
    showError('');
    $('authTransfer').hidden = true;
    try {
      const snap = await cloudPath(user.uid).get();
      if (seq !== switching) return;
      if (snap.exists) {
        window.PortfolioApp.loadProfile(snap.data());
        canWrite = true;
        hideGate();
        setLoading(false);
      } else if (hasVisitorData()) {
        // Never silently move private visitor holdings into a Google account.
        showGate();
        $('authTransfer').hidden = false;
      } else {
        window.PortfolioApp.loadProfile({holdings:[],goals:null,adviceBudget:10000});
        canWrite = true;
        hideGate();
        setLoading(false);
      }
      updateBadge();
    } catch (e) {
      if (seq !== switching) return;
      showGate();
      showError('無法讀取你的雲端資料。請檢查 Firestore 是否啟用及安全規則是否正確。'+(e.code?' ('+e.code+')':''));
      updateBadge();
      setLoading(true);
    }
  }
  function saveProfile(data) {
    if (!user || !canWrite) return Promise.reject(new Error('尚未完成雲端資料載入'));
    const uid = user.uid;
    // Serialize saves to preserve the ordering of edits and avoid stale overwrites.
    saveSerial = saveSerial.catch(()=>{}).then(async () => {
      if (!user || user.uid !== uid || !canWrite) return;
      await cloudPath(uid).set({
        holdings: data.holdings, goals: data.goals, adviceBudget: data.adviceBudget,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (user?.uid === uid) $('lastSaved').textContent = '私人雲端已同步 · '+new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
    }).catch(e => {
      showError('雲端寫入失敗，這次變更尚未確認儲存：'+(e.code || e.message || e));
      showGate();throw e;
    });
    // Caller may not await; keep a no-unhandled-rejection boundary.
    saveSerial.catch(()=>{});
    return saveSerial;
  }
  const session = {
    isSignedIn: () => !!user,
    canWrite: () => !!user && canWrite,
    saveProfile
  };
  window.PortfolioAccount = session;

  async function login() {
    if (!configured) {
      showError('目前尚未設定 Firebase Google 登入。請先按照 README 完成 Firebase 設定；可使用訪客模式體驗。');
      return;
    }
    showError('');$('googleLogin').disabled = true;
    try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
    catch(e) { showError('Google 登入未完成：'+(e.code || e.message || e)); }
    finally { $('googleLogin').disabled = false; }
  }
  async function migrateGuest(migrate) {
    if (!user) return;
    const previous = window.PortfolioApp.visitorSnapshot();
    const chosen = migrate ? previous : {holdings:[],goals:null,adviceBudget:10000};
    try {
      $('migrateGuest').disabled = true;$('startCloudFresh').disabled = true;
      window.PortfolioApp.loadProfile(chosen);
      canWrite = true;
      await saveProfile(window.PortfolioApp.snapshot());
      $('authTransfer').hidden = true;
      setLoading(false); hideGate();updateBadge();
    } catch(e) {
      canWrite = false; showGate();showError('首次寫入私人雲端失敗，請確認安全規則。');
    } finally {$('migrateGuest').disabled = false;$('startCloudFresh').disabled = false;}
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('openAccount').addEventListener('click', () => { updateBadge();showError('');showGate(); });
    $('closeAuth').addEventListener('click', () => {
      if (!user || canWrite) hideGate(); else showError('雲端尚未載入完成。請選擇資料來源或登出後以訪客模式使用。');
    });
    $('guestContinue').addEventListener('click', hideGate);
    $('googleLogin').addEventListener('click', login);
    $('signOut').addEventListener('click', async () => {showError(''); if(auth) await auth.signOut(); else resetForVisitor(); hideGate();});
    $('migrateGuest').addEventListener('click', () => migrateGuest(true));
    $('startCloudFresh').addEventListener('click', () => migrateGuest(false));
    if (!configured) {
      $('googleLogin').disabled = true;
      $('authSetupNote').textContent = 'Google 登入尚未啟用：請先在 Firebase 設定 Auth、Firestore 和網域，並填寫 firebase-config.js。現在可直接使用訪客模式。';
      updateBadge();
      if (!wasSeen()) showGate();
      return;
    }
    $('authSetupNote').textContent = 'Google 登入已啟用；所有登入資料依 Firebase Firestore Rules 存於個人專屬路徑。';
    try {
      firebase.initializeApp(config);
      auth = firebase.auth();db = firebase.firestore();auth.useDeviceLanguage();
      setLoading(true);
      auth.onAuthStateChanged(onUserChanged, e => {showError('無法讀取登入狀態：'+e.message);setLoading(false);showGate();});
    } catch(e) {
      showError('Firebase 初始化失敗：'+e.message);
      setLoading(false);showGate();
    }
  });
})();
