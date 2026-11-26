# Deutsch-Quest 德文闖關網站 ＋ Friends 德語逐集學習內容庫

## 網站（`site/`）

手機優先的德文闖關網站，純 HTML／CSS／JavaScript，沒有建置工具。進度只存在使用者自己的瀏覽器。

| 區域 | 內容 | 教材檔 |
| --- | --- | --- |
| 生活地圖 | 鄰里、學校、家長圈、衝突四區的句子卡、聽力小測驗、角色扮演提示詞 | `site/content/life.json` |
| Central Perk | 236 集目錄、字幕教案、金句卡、填空、原創對話 | 根目錄的 Friends 資料 ＋ `site/content/friends_cards.json` |
| Nachrichten | 每日德國與慕尼黑新聞標題、摘要、原文連結 | `tools/news_feeds.json` 設定來源 |
| Einbürgerungstest | 入籍考試的價值與憲政練習題（自編，非官方題庫）、核心詞彙 | `site/content/einbuergerung.json` |
| Fahrprüfung | 路考考官指令、聽指令測驗 | `site/content/fahrpruefung.json` |
| 今天／複習 | 每日四步驟、XP 與連續天數、間隔複習卡（名詞先選 `der` / `die` / `das` 冠詞再翻面） | 存在瀏覽器 |

### 單字冠詞（Artikel）與母語語音功能

- **冠詞標示與練習**：以 `der` / `die` / `das` 開頭的名詞單字卡會顯示分色冠詞標籤；在複習卡（`Wiederholen`）翻面前會先隱藏冠詞並提供 `der` / `die` / `das` 選擇按鈕，且在 Friends 單集教案、電影場景與入籍考試的核心詞彙區提供「練冠詞（der / die / das）」三選一測驗。
- **德國母語靜態音檔（`site/audio/`）**：已使用 `edge-tts`（`de-DE-ConradNeural`）預先產生 551 個靜態 `.mp3` 音檔與 `site/audio/manifest.json`，預設以 `1×` 原速播放；GitHub Pages 與下載本 repo 的使用者皆可直接播放相同音檔，無需額外設定。

本機預覽與音檔工具：

```bash
python tools/build_site.py            # 產生 site/data/（加 --no-news 可離線執行）
python -m http.server 8000 --directory site
```

若本機要即時合成尚未收錄於靜態音檔的句子（例如每日新聞）或切換試聽 `de-DE-ConradNeural`／`de-DE-AmalaNeural`：

```bash
pip install edge-tts
python3 tools/dev_server.py --port 8001   # 含 /api/tts 端點
python3 tools/build_audio.py              # 重新批次產生 site/audio/ 靜態 .mp3
```

部署：`.github/workflows/site.yml` 在每次推送到 `main` 以及每天 04:30 UTC 執行測試、抓新聞、發佈到 GitHub Pages。第一次使用前，到 repo 的 Settings → Pages，把 Source 設為 **GitHub Actions**。

新增 Friends 教材不需要改網站：`data/subtitle_lessons/*.json` 與 `friends_episodes_236.json` 更新後，下一次部署會自動帶入。

新聞只儲存標題、短摘要與連結，全文留在原網站。入籍考試題目為自編練習，正式準備請搭配 BAMF 官方題庫。


---

## Friends 德語逐集學習內容庫

建立日期：2026-11-16。此資料包可用作逐集德語學習與討論平台的內容起點。

## 字幕教材進度（2026-11-16，已完成2批）

已依你提供的字幕完成 **18集詳細教材**，保存25個不同來源版本。原有236集概覽仍可使用；新增教材以 `episode_id` 與概覽連接。

| 季別 | 已完成字幕教材 | 學習單 | JSON資料 |
| --- | --- | --- | --- |
| 第1季 | S01E01–S01E04、S01E18，共5集 | [閱讀第1季](docs/season_01_subtitle_lessons.md) | [season_01.json](data/subtitle_lessons/season_01.json) |
| 第4季 | S04E18，共1集 | [閱讀第4季](docs/season_04_subtitle_lessons.md) | [season_04.json](data/subtitle_lessons/season_04.json) |
| 第5季 | S05E01–S05E05、S05E08–S05E14，共12集 | [閱讀第5季](docs/season_05_subtitle_lessons.md) | [season_05.json](data/subtitle_lessons/season_05.json) |

這18份教案共108個詞彙項目、36個語法重點、54題討論與36個場景練習。字幕引用位置已按原檔核對；摘要、例句、題目與答案提示均為原創。時間碼只對應所註明的字幕版本，尚未與影片或德語配音核對。

第二批有3處配集修正：pilot ZIP內另含S01E18；第4集ZIP內的兩個BluRay檔案將S01E03與S01E04檔名互換。已依內容確認集數，保留原檔名、原始雜湊與[核對紀錄](data/subtitle_resolutions/batch_2026-11-16_02.json)。S05E13的兩個版本也保持分開，並非上下兩部分。

- [字幕涵蓋進度](data/subtitle_coverage.json)：已收到、仍缺少的集數及教案狀態。
- [跨對話接續紀錄](PROJECT_STATUS.md)：下一批上傳的接續位置。
- [字幕匯入與配集流程](docs/subtitle_workflow.md)：編碼、去重、版本及錯誤標籤處理。

完整來源字幕與逐條解析資料另存於合併來源下載包；公開儲存庫包含教材及來源紀錄。原有Excel、CSV與236集JSON作為全劇概覽，較詳細的字幕教材存放於上列獨立檔案。

## 已完成的內容

- 全10季、236集的德文與英文集名，以及穩定的 `episode_id`。
- 每集一則自行撰寫的德文短摘要和繁中摘要。
- 每集一個學習主題、一項語言練習方向、三個德中詞彙、一題德中討論題。
- 共708筆詞彙選項（包含不同集數之間的重複詞彙）、236題討論題。
- 10則獨立創作的日常對話，每則6個發言，共60個德中對照發言。
- 每集獨立來源連結、查詢日期及摘要／音軌核對狀態。

WBD官方資料列出正篇共236集；重聚特輯另計：[官方新聞稿](https://press.wbd.com/us/media-release/one-where-they-got-back-together)。各季集數依序為24、24、25、24、24、25、24、24、24、18。

## 檔案

| 檔名 | 用途 |
| --- | --- |
| `friends_german_learning.xlsx` | 直接閱讀、篩選逐集內容；附使用說明及原創對話示範。 |
| `friends_episodes_236.json` | 236筆物件的JSON陣列，適合網站或資料庫匯入。 |
| `friends_episodes_236.csv` | UTF-8 BOM試算表交換格式；詞彙放在單一儲存格。 |
| `friends_original_dialogues_10.json` | 原創對話、中文翻譯、語言說明與延伸任務。 |
| `dataset_manifest.json` | 範圍、內容類型、來源說明及播放單元映射例子。 |

## 內容應如何標示

所有德文摘要都是重新撰寫的學習用短文，並非官方德語配音、字幕翻譯或劇本節錄。每則只挑選一至兩條情節線，不是逐場完整劇情；內容可能涉及劇透。

詞彙、討論題、語言重點和Anna／Ben示範對話都是原創教材，不表示這些字句一定在影集中出現。10則對話使用另創人物與新情境，不重建原劇場景。

原有236集概覽的來源是逐集節目短介與搜尋索引提供的單集短介；部分容易混淆的上下集另以Apple TV官方英文介紹核對。德語音軌尚未逐集比對。因此本資料適合劇情理解、閱讀與討論；正式的聽寫答案或逐字跟讀材料，需另以使用者實際觀看版本核對。

A2–B1、B1–B2是本資料的練習難度建議，並非本劇的官方CEFR評級。

本資料包沒有影音、劇照、歌曲歌詞、完整字幕或半集逐字稿，也不授予Friends作品與商標的任何使用權。平台若要公開提供這些影音或逐字文本，需另行確認相應授權。

## 平台第一版的頁面

| 頁面 | 使用者要完成的事 | 可直接使用的資料 |
| --- | --- | --- |
| 逐集目錄 | 按季、主題、練習程度找一集 | ID、季集數、集名、主題、程度 |
| 單集學習頁 | 先讀背景，再觀看自己的合法版本 | 德中摘要、來源與觀看版本欄位 |
| 詞彙與表達 | 查看3個起始詞彙並造自己的句子 | 詞彙、語言練習方向 |
| 每集討論 | 回答問題、回應同學、提出追問 | 德中討論題 |
| 口說／寫作 | 提交錄音或短文，取得可解釋的回饋 | 原創情境、討論題與句型 |
| 我的複習 | 找到錯誤、收藏詞彙、重新提交 | 需另建個人進度與學習紀錄 |

每集固定使用相同操作流程：閱讀簡介、觀看、重述、討論、回顧自己的答案。對新使用者，先顯示德文，中文可按需展開；劇情摘要預設折疊以保留自行觀看的選擇。

## 每集的分層任務

| 層級 | 任務 | 建議產出 |
| --- | --- | --- |
| A2 | 說出人物、需求與主要事件；使用簡單句型 | 3–5句短答或約30秒口說 |
| B1 | 重述主要情節、解釋人物選擇 | 約80–120個德文字或60–90秒口說 |
| B2 | 比較動機、提出反例、回應他人的立場 | 有立場、理由及追問的討論回覆 |

這是課程設計提案，可以依實際程度調整。先用前3集與5位左右的試用者觀察流程；確認大家能完成重述和互動後，再擴充更多聽力素材。

## 第一集教案範例

S01E01：Liebe? Nein, doch nicht!。本集摘要參考[逐集介紹](https://www.fernsehserien.de/friends-1994/folgen/1x01-liebe-nein-doch-nicht-55918)。

學習主題：新生活與朋友支持。

原創德文摘要：Rachel verlässt ihre Hochzeit und sucht bei Monica Unterstützung für einen Neuanfang. Ross versucht gleichzeitig, mit der Trennung von Carol umzugehen.

起始詞彙：der Neuanfang（新開始）、die Unterstützung（支持）、sich trennen（分手）。

原創討論題：Welche Hilfe braucht Rachel, um ein selbstständiges Leben zu beginnen?

可用句型：Ich glaube, dass …；Sie braucht …, weil …；An ihrer Stelle würde ich …。這些是學習句型，不是劇中台詞。

討論操作：先用3句回答，再回應一位學習者。回應時指出一個同意之處，補充一個理由，最後問一個開放問題。AI回饋先確認是否理解意思，再指出最多3個優先改善點，保留原句與建議句供比較。

原創口說情境：Anna家中的暖氣要維修，想暫住Ben家兩晚。請閱讀 `friends_original_dialogues_10.json` 的S01E01對話，再改成只借住一晚、早上六點離開的新版本。

## 配音、字幕與播放版本

[Apple TV德國節目頁](https://tv.apple.com/de/show/friends/umc.cmc.4dxfvjbc4rdww1dcp3kbgoaqm)列有德語音軌。[本次可讀的Prime Video第10季商品頁](https://www.primevideo.com/-/de/detail/0M62QKG5IWILV60MICRSLJVM4H?tr=pf)列有德語音軌與德語字幕，但不能據此推定所有地區帳號都能觀看相同版本。購買或訂閱前應查看實際帳號顯示的語言選項。

[Netflix德文字幕規範](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217351587-German-Timed-Text-Style-Guide)區分外語翻譯字幕與SDH。已配成德語的作品，SDH應以配音稿或音軌為基礎，但仍可能因閱讀速度與時間限制調整。這支持平台把字幕與配音分開記錄；不是宣稱已逐集比對Friends的字幕差異。

Prime Video上述第10季頁把最後兩部分列為第17個播放單元。資料庫仍保留S10E17和S10E18，另外建立播放單元對應。不要把標準episode_id直接當作某服務的播放器索引，也不要將一個版本的時間碼套用到其他版本。

## 核心資料欄位

| 欄位 | 說明 |
| --- | --- |
| `episode_id` | 穩定鍵，例如S01E01；保留前導零。 |
| `season`, `episode`, `overall_episode` | 季數、季內集數、全劇順序；數值型別。 |
| `title_de`, `title_en` | 德語集名與英文集名；平台可能另有標題變體。 |
| `summary_de`, `summary_zh` | 原創德語及繁中情節短摘要。 |
| `theme_zh`, `suggested_level`, `language_focus` | 原創教學標記。 |
| `vocabulary` | JSON中的三筆 `{de, zh}` 物件；CSV改為文字欄。 |
| `discussion_de`, `discussion_zh` | 原創討論題及繁中翻譯。 |
| `source_url` | 主要劇情來源；每集獨立。 |
| `secondary_sources` | 個別需要時的補充核對來源。 |
| `source_language`, `source_access`, `retrieved_on` | 來源語言、讀取範圍、查詢日期。 |
| `metadata_source_url` | 德英集名與標準集數的索引來源。 |
| `verification_status`, `audio_verified` | 劇情短介已核對；音軌尚未核對。 |
| `content_type`, `exercise_content_type` | 摘要與題目分別標記為原創摘要、原創練習。 |

如之後加入音訊、時間碼與社群資料，建議另外建立以下實體，不要把使用者內容混進教材來源欄：

- `editions`：服務、地區、版本、音軌語言、字幕類型、檢查日期。
- `playback_units`：版本內的播放單元及對應的一個或多個episode_id。
- `learning_items`：一題／一個情境、內容類型、語言、難度及審核狀態。
- `discussion_threads`、`posts`：每集討論及回覆，可依episode_id和題目定位。
- `attempts`、`progress`：學習者提交、回饋、複習日期與完成狀態。

若加入已獲許可的短節錄，再另記 `edition_id`、`playback_unit_id`、`start_seconds`、`end_seconds`、`speaker`、`text_origin`、`permission_note`、`review_status`。沒有實際核對的時間碼一律保持空值，AI不得自行補出看似精確的秒數或配音句子。

## 驗收重點

匯入後應恰有236個不重複ID，各季集數一致；每個問題能連回自己的集數。每集起始詞彙有3筆，10則對話各有6個發言。所有原創教材顯示正確標籤，中文輔助可以展開，使用者能完成一則回答並回覆他人。

目前已有靜態學習網站原始碼，並在部署時讀取236集概覽及18集字幕教案。學習進度儲存在使用者瀏覽器；登入、社群回覆、錄音、AI評語與跨裝置進度仍未實作。網站是否已成功上線，請以GitHub Actions部署結果為準。
