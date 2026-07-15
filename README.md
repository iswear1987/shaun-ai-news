# Word Strike — 空战打字

卡通风格 **空战打字游戏**（Three.js）：你的战机持续向前飞，通过输入英文单词击落前方敌机；每波战斗 1 分钟后挑战名人名言 BOSS，击破后天空在白天 / 黄昏 / 黑夜之间循环。

## 玩法

1. **双机编队**
   - **近处敌机**：显示英文单词 + 词性 + 中文释义（完整信息）
   - **远处敌机**：仅显示较小的英文单词
2. **击落推进**：消灭近处敌机后，远处敌机立刻前移成为新目标，并刷新下一架远处敌机
3. **BOSS 波次**
   - 无总时限；每消灭 **30 架**普通敌机出现 BOSS（WARNING 提示不锁输入）
   - BOSS 下方为英文名人名言，需完整输入（含空格与标点，字母不区分大小写）
   - 击破 BOSS 后天空切换：**白天 → 黄昏 → 黑夜 → 白天…**，并开始下一波
4. **反击**：输错字母时近处敌机（或 BOSS）向玩家发射红色激光并扣分
5. **计分**：正确字符 +1 · 击落敌机 +5 · BOSS +50 · 连击 ×2 / ×3 · 错误 −1 断连击

## 快速开始

```bash
python -m http.server 8080
```

浏览器打开 `http://127.0.0.1:8080/`（需联网加载 Three.js CDN）。

## 项目结构

```
hit_words/
├── index.html
├── css/style.css
├── js/
│   ├── main.js      # 波次 / 双机 / BOSS / 计分
│   ├── scene.js     # Three.js 空战场景与天空
│   └── sounds.js
├── data/
│   ├── ogden_850_words.csv
│   ├── word_meta.json    # 词性 + 中文
│   └── quotes.json       # 名人名言
└── README.md
```

## 技术

- Three.js r170（import map + CDN）
- 卡通 toon 材质战机、程序化天空与云层
- 屏幕空间标签跟随 3D 机体
- Web Audio 音效

## 自定义

| 位置 | 含义 |
|------|------|
| `js/main.js` → `BOSS_EVERY` | 出 BOSS 所需击杀数（默认 30） |
| `data/quotes.json` | BOSS 名言 |
| `data/word_meta.json` | 词性 / 中文 |
