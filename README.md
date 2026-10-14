# 今天吃什么（what-to-eat-today）

一个帮你决定「点外卖」还是「自己做」的静态网页。选择用餐方式后，页面会从对应的数据中随机推荐一道；菜谱推荐还可以查看食材和制作步骤。

## 现有功能

- 外卖推荐：展示菜名、分类和图片，可以点击「换一个」重新推荐。
- 菜谱推荐：展示菜名、分类、难度和图片，可以重新推荐，也可以进入详情查看食材与步骤。
- 切换推荐时会尽量避开当前菜品；图片加载失败时会显示提示。

数据位于 `data/takeout.json` 和 `data/recipe.json`，当前各有 50 条。图片资源存放在 `images/food/`。

## 本地运行

项目是原生 HTML、CSS 和 JavaScript，无需安装前端依赖。在仓库根目录启动静态 HTTP 服务，例如：

```bash
python -m http.server 8000
```

然后访问 `http://localhost:8000/`。页面使用 `fetch` 读取 JSON，直接双击 `index.html` 以 `file://` 打开时，浏览器可能阻止数据加载。

## 项目结构

```text
index.html              页面结构与入口
css/style.css           页面样式
js/app.js               推荐、页面切换及数据和图片加载逻辑
data/takeout.json       外卖数据
data/recipe.json        菜谱数据
images/food/            菜品图片
analyze_checker.py      图像分析辅助脚本
process_checkerboard.py 图像处理辅助脚本
```

两个 Python 辅助脚本不参与网页运行，并使用了开发时的本机文件路径。

## 数据格式

外卖记录包含 `name`（名称）、`category`（分类）和 `image`（相对仓库根目录的图片路径）。菜谱记录还包含 `difficulty`（难度）、`ingredients`（食材数组）和 `steps`（步骤数组）。新增或修改记录时，保持 JSON 数组格式，并确保图片路径对应的文件存在。
