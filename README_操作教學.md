# 持倉日誌：VS Code + GitHub Pages 極簡版

**只做兩件事：管理持股、依股票代號自動帶入最新可取得的台股官方收盤價。**

## 1. 功能

- 新增、編輯、刪除持股（股票代號、上市/上櫃、股數、每股平均買進成本）
- 從行情檔 `quotes/market.json` 自動帶入單價、股票名稱、交易日
- 自動計算總市值與未實現損益；查不到報價時會明確顯示「—」，不會假裝報價是零元
- 本機瀏覽器自動儲存持倉；匯出與匯入 JSON 備份
- 不需要申請 Google Cloud OAuth Client ID，不需要登入、不需要輸入 API 金鑰

**只支援台灣上市（TWSE）與上櫃（TPEx）股票及 ETF，幣別為新台幣。** 目前使用最近交易日**收盤價**，不是盤中即時價。股票停牌、尚無資料、欄位變動、API 暫時無法連線時可能沒有報價。

## 2. 在 VS Code 執行

1. 解壓縮 ZIP，開啟 VS Code，點選「檔案 → 開啟資料夾」，選擇解壓後的整個資料夾。
2. 安裝 `Live Server`（Ritwick Dey）。
3. 開啟 `index.html`，右鍵選「Open with Live Server」，瀏覽器會打開 `http://127.0.0.1:5500/`。
4. 點「＋ 新增持股」並輸入代號、股數及每股買進成本。
5. **第一次下載 ZIP 時，行情檔是空的**，需要執行第 3 步下載行情，畫面才會顯示股價。這不是 Google 登入錯誤。

## 3. 下載最新台股收盤資料（本機）

電腦要有 Python 3.9+。在 VS Code 終端機 Terminal → New Terminal 輸入：

```bash
python tools/update_quotes.py
```

Windows 若 `python` 失敗，可以試：

```bash
py tools/update_quotes.py
```

當官方 API 可以連線時，它會生成／更新 `quotes/market.json`。再回到瀏覽器按「更新股價」。若網站已開，Live Server 可能自動重新整理。

> 網站本身不會把「查詢股票代號」送到任何報價 API；行情先由腳本下載上市／上櫃官方全市場資料為 JSON 檔，大家開網站再依自己輸入的代號找到對應價格。這能避開 GitHub Pages 的跨網域限制。

## 4. 放到 GitHub Pages，讓大家可以用

1. GitHub 建立一個 **Public** Repository，例如 `portfolio-ledger`。
2. 把整個資料夾上傳到儲存庫。**記得連 `.github/workflows/quotes.yml` 這個隱藏資料夾也要上傳。** 建議用 VS Code Source Control 或 Git 指令 `git add .`，不要只手動上傳看得見的幾個檔。
3. GitHub Repository → **Settings → Pages → Build and deployment → Source 選 GitHub Actions**。不是 `Deploy from a branch`。
4. 打開 **Actions** 頁面，選「更新行情並發布網站」，按 `Run workflow`，選 `main` → Run workflow。
5. Actions 執行成功後，回到 Settings → Pages，點 `Visit site` 開啟網站。
6. Workflow 設定台灣時間**每個工作日下午 16:30** 自動更新官方收盤行情並發布網站；實際啟動可能延遲，遇到 API 失敗時網站仍可發布，但行情可能停留在舊日期。

> 若 Actions 提示 `Resource not accessible by integration` 或無法 push 行情，請到 Settings → Actions → General → Workflow permissions，允許 Read and write permissions。網站部署需 GitHub Pages 已開啟且 Source 設為 GitHub Actions。

### 為什麼 GitHub Pages 也能自動更新股價？

GitHub Pages 不會執行 Python 後端。本專案的 **GitHub Actions** 會按排程執行 `tools/update_quotes.py`、下載官方公開盤後行情、保存為網站上的 JSON，再直接發布更新後的網站。使用者無須輸入股票現價。

GitHub 官方文件： https://docs.github.com/en/actions/reference/events-that-trigger-workflows

### 定時更新的重要限制

- 官方盤後資料可能延後發布；16:30 尚未更新時，畫面會依官方資料顯示舊日期。
- GitHub Actions 的 `schedule` 可能延遲，甚至偶發漏執行；不能保證每天恰好 16:30 更新。
- GitHub 公開 Repository 連續 60 天沒有活動，排程可能被 GitHub 自動停用，需回到 Actions 重新啟用。
- 若 GitHub 的伺服器無法連到其中一個資料來源，程式會保留先前該市場已成功取得的行情；日期顯示可能過期。

## 5. 兩位使用者的持倉會混在一起嗎？

**不會，但也不會跨裝置同步。** 每位使用者輸入的持股儲存在**自己的瀏覽器 localStorage**；不會存入 GitHub。網頁共用的只有**公開市場報價**。

- 換瀏覽器、無痕視窗或清除網站資料，可能看不到以前的持股。
- 使用「匯出 JSON」備份，再到另一台電腦「匯入備份」，可轉移持股。
- 如果未來要「同一帳號在手機與電腦同步」，就需要再加入登入與私人雲端資料庫（這版為了避免 Google OAuth 錯誤，已先移除）。

## 6. 檔案對照

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 網頁架構 |
| `style.css` | 網頁樣式 |
| `app.js` | 持倉新增/編輯/刪除、計算與報價呈現 |
| `quotes/market.json` | 公開的最近收盤價資料，**沒有個人持股** |
| `tools/update_quotes.py` | 下載台灣上市與上櫃官方收盤價 |
| `.github/workflows/quotes.yml` | 每日盤後更新與自動發布 GitHub Pages |
| `.vscode/settings.json` | Live Server 預設埠 5500 |

## 7. 報價資料來源與範圍

- TWSE 官方 OpenAPI： https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
- TPEx 官方 OpenAPI： https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes

對應資料是**最近一個交易日**未還原的收盤行情，不適合當成可交易的即時報價。價格可能受到除權息、拆併股影響，績效計算未納入交易稅費、股息與已實現損益。請遵循資料來源授權、標示來源並確認公開再利用條款。
