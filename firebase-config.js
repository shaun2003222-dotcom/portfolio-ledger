/*
 * 先在 Firebase Console 建立 Web App，再將設定貼入下方。
 * Firebase Web config (apiKey, authDomain 等)不是密碼；安全性依賴 Authentication 與 Firestore Rules。
 * 切勿在此放入 Admin SDK 私鑰、service account JSON 或其他伺服器密鑰。
 * 未設定時，網站照常提供完整訪客模式。
 */
window.PORTFOLIO_FIREBASE_CONFIG = null;
/* 範例格式（請用你自己的 Firebase 專案值取代，不要直接用範例）
window.PORTFOLIO_FIREBASE_CONFIG = {
  apiKey: '你自己的 Firebase Web API Key',
  authDomain: '你的專案.firebaseapp.com',
  projectId: '你的專案 ID',
  appId: '你自己的 App ID'
};
*/
