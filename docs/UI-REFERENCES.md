# 新版前端 UI 与可参考的开源项目

## 这次的设计

> 族谱页目前采用了 **family-chart 的横向人物卡片 + 细折线** 形态（方形肖像、男/女淡色底、配偶小色签），但没有直接引入其运行时；这样保留了现有的分支折叠、PNG 导出、人物笺和已故色标记。如果你希望连它的布局算法、缩放/迷你图行为也完全交给这个库，可以再做一版直接接入。

新版前端叫「纸谱 · 墨线」：宣纸底、墨线、朱砂印，左侧谱签式导航，人物关系页是一张可以拖动、缩放、按视野懒加载的谱系桌面。

- 谱心人物固定在桌面中央，上一代在上、同辈居中、下一代在下；
- 同一代人物横向排开，父母/子女用竖向墨线相连，配偶用朱线并在中点打结；
- 初始只加载谱心的一度亲缘；拖动画布或滚轮缩放后，视野附近尚未展开的人物会被逐个加载；
- 新人物从父节点方向生长入场，连线逐条绘出，节点旁会出现「+N 亲缘」的提示；
- 默认只显示谱心的直接关系；展开后出现的旁支用淡线相连，点「旁支」可显示全部，点「称谓」可显示所有关系称谓；
- 「墨夜」深色主题、移动端底部导航、移动端人物抽屉都已适配。


## 开源项目参考

如果需要继续借鉴别的 UI，下面这些项目值得先看截图/演示，再决定是否引入依赖。当前实现没有引入它们，是为了把「纸谱」的视觉和懒加载节奏完全掌握在自己手里。

### 族谱 / 家谱专用

- **Topola** — <https://github.com/PeWu/topola>
  TypeScript 写的族谱可视化查看器，支持 GEDCOM，树形布局和人物卡片值得参考；适合看「族谱长卷」还可以怎么排。
- **family-chart** — <https://github.com/donatso/family-chart>
  基于 D3 的家族树组件，人物卡片、夫妻并排、子女分组做得比较完整，适合参考族谱页的卡片与连线。
- **dTree** — <https://github.com/ErikGartner/dTree>
  支持「多父母」的家族树 D3 库，适合复杂婚姻/收养关系的展示。
- **webtrees** — <https://github.com/webtrees/webtrees>
  成熟的 PHP 家谱应用，重点可以看它的谱系页、人物页和编辑流程，而不是视觉风格。

### 通用关系图 / 大图交互

- **Sigma.js** — <https://github.com/jacomyal/sigma.js>
  WebGL 图渲染，配 Graphology 做增量数据、相机动画和大图性能都很好；如果以后族谱规模到几万人，可以重点考虑。
- **Graphology** — <https://github.com/graphology/graphology>
  图数据结构与算法，和 Sigma 搭配；适合做「按视野取子图」的底层。
- **React Flow / xyflow** — <https://github.com/xyflow/xyflow>
  React 节点图组件，平移缩放、MiniMap、Controls、自定义节点都很成熟；适合做「人物卡片 + 连线」的交互底座，但族谱的世代对齐要自己写。
- **AntV G6** — <https://github.com/antvis/G6>
  国内常用的图可视化引擎，布局和交互插件多，文档中文友好。
- **react-force-graph** — <https://github.com/vasturiano/react-force-graph>
  2D/3D 力导向图，适合探索「关系网」而不是严格族谱；视觉上要再包一层。
- **Cytoscape.js** — <https://github.com/cytoscape/cytoscape.js>
  上一版前端用的库；功能全，但默认视觉偏工程化，这次没有继续使用。
- **vis-network** — <https://github.com/visjs/vis-network>
  老牌关系图库，上手快，适合快速做原型。

## 建议的参考顺序

1. 先看 **Topola** 和 **family-chart** 的族谱 UI，确定人物卡片、夫妻/子女分组的表达；
2. 如果以后数据量明显变大，再看 **Sigma.js + Graphology** 的按需加载和相机动画；
3. 如果更想用现成 React 组件，**React Flow** 的自定义节点 + MiniMap 是最省事的底座；
4. 视觉上不要直接套用这些库的默认主题——它们的默认样式偏「工具」，而本项目的「纸谱」需要宣纸、墨线、朱砂印这套自己的设计语言。
