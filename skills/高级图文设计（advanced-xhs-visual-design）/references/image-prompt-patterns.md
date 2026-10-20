# 高级提示词模式拆解

## 先说结论
真正高级的 prompt，不是单纯写得更长，而是把“画面决策链”写完整了。

核心不是堆形容词，而是同时控制这 9 层：
1. **媒介/画面类型**：film photography、poster、infographic、UI screenshot、watercolor editorial
2. **主体定义**：谁，什么物，什么场景，什么时代，什么身份
3. **镜头与构图**：medium shot、symmetrical composition、9:16、negative space、极端透视
4. **光线系统**：fluorescent、neon、rim light、soft morning fog、flash、window light
5. **材质与细节**：skin texture、micro pores、fabric wrinkles、paper grain、brush marks、glossy floor
6. **色彩策略**：低饱和、高级配色、主色+强调色，而不是乱堆颜色
7. **情绪与叙事**：quiet temptation、epic、mysterious、celebratory、museum-grade
8. **版式/文字约束**：title placement、中文标注、字体风格、信息层级
9. **负面约束**：不要 plastic skin、不要 cheap poster feel、不要乱码、不要模板感

## 这些案例里最值钱的 6 个规律

### 1) 先定“媒介”，再定“主体”
高手不是一上来写“一个女孩/一张海报”，而是一上来先锁死成像语言。

例如：
- `35 mm film photography`
- `museum-style infographic`
- `cinematic minimal portrait`
- `poster-grade dynamic integrated typography`

这一步决定了画面的底层审美，不是装饰项。

### 2) 高级感来自“少数强决策”，不是信息平均分布
最好的 prompt 往往有一个强支点：
- 一个强轮廓
- 一条强动线
- 一个强光源系统
- 一个强版式结构

例如波士顿海报里，真正的核心不是“城市元素很多”，而是“船桨水痕 upward sweep 成河流再变城市”。这就是强概念。

### 3) 好 prompt 会同时写“主元素”和“次级证据”
只写“高级、电影感”没用，要补能证明它高级的细节证据：
- skin texture / micro pores
- realistic reflections on glass
- fabric drape / wrinkles
- paper texture / brush marks
- typography placement

也就是：**抽象审美词 + 可视化证据词**。

### 4) 高级提示词普遍有“控制噪音”的能力
几乎所有强案例都在主动限制模型：
- 不要塑料感
- 不要过锐
- 不要过度装饰
- 不要拥挤
- 不要廉价霓虹
- 不要乱码

高质量 prompt 的本质之一，就是帮模型删错。

### 5) 真正强的 prompt 会写“关系”，不只写“对象”
普通 prompt：一个女孩站在便利店门口。
高级 prompt：
- 人与门框的关系
- 身体弧线与脚部位置关系
- 内部冷白灯与外部霓虹的关系
- 玻璃反射与背景货架的关系

也就是从“有什么”升级为“它们怎么互相作用”。

### 6) 版式类 prompt 不是画图，是在写视觉系统
做海报、信息图、UI 时，核心不再是“美图”，而是：
- 信息层级
- 主标题位置
- 文字与图的主次
- 留白
- 结构稳定性
- 平台比例

所以这类 prompt 要把“版式规则”直接写进 prompt。

## 可复用的高级 prompt 骨架

```text
[媒介/风格类型],
[主体 + 场景 + 时代/身份],
[镜头 + 构图 + 比例],
[光线系统],
[色彩策略],
[材质/纹理/真实细节],
[动作/空间关系/叙事线索],
[背景与辅助元素],
[文字/版式规则，如果有],
[整体气质],
[负面约束]
```

## 四类最值得长期复用的模式

### A. 摄影人像模式
公式：媒介 + 光线混合 + 脸部与皮肤细节 + 服装材质 + 姿态关系 + 背景证据 + 负面词

### B. 海报模式
公式：强概念 + 单一视觉支点 + 留白 + 主标题规则 + 高级配色 + 不拥挤

### C. 信息图模式
公式：中心主视觉 + 固定分区 + 中文标注 + 材质/结构/说明 + 统一纸面气质

### D. UI/截图模式
公式：指定设备或平台 + 明确页面层级 + 文本类型 + 真实交互元素 + 截图感证据

## 以后我帮你写“超级 prompt”的默认方法
以后你只要告诉我这 5 个信息，我就能直接按这个体系出高质量 prompt：
1. 要画什么
2. 用在什么平台，封面/配图/海报/信息图/视频帧
3. 想要什么气质，克制/史诗/科技/文博/商业
4. 有没有参考对象或禁区
5. 比例尺寸

如果你懒得说细，我也可以直接按“高级、克制、可传播”的默认审美帮你补全。 
