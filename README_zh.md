# Endfield Tool ——《明日方舟：终末地》生产计算器

[English](./README.md)

[![在线体验](https://img.shields.io/badge/🚀_在线体验-立即使用-success?style=for-the-badge)](https://jamboChen.github.io/endfield-tool)
[![QQ Group](https://img.shields.io/badge/QQ-1075221296-blue?logo=tencentqq)](https://qm.qq.com/q/2vdhjwYXVC)
[![Discord](https://img.shields.io/badge/Discord-加入社区-5865F2?logo=discord&logoColor=white)](https://discord.gg/6V7CupPwb6)
[![许可证](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![表格视图](./img/table-view.png)
![依赖树（合并）](./img/tree-merged.png)

## 项目概述

Endfield Tool 是一款面向 **《明日方舟：终末地》** 的综合性生产规划与优化计算工具。  
它可以帮助玩家设计高效的生产链，精确计算资源需求、设施数量，并处理复杂的配方依赖关系——包括存在循环的生产链。

---

## 核心功能

### 🎯 生产规划
- **多目标规划**：可同时设置多个生产目标，并为每个目标指定期望的产出速率  
- **自动依赖解析**：递归计算所有所需的中间产物与基础原料  
- **实时重算**：修改生产目标、配方或配置后，结果即时更新

---

### 🔄 智能配方管理
- **智能配方选择**：自动选择最优配方，并避免产生问题性的循环依赖  
- **手动锁定配方**：在需要精细控制时，可为特定物品指定固定配方  
- **循环依赖处理**：可检测并解决循环生产链（例如“自身作为原料”的配方），通过数学上的稳态分析计算稳定的投入与产出关系

---

### 🏭 设施优化
- **设施数量计算**：精确计算每个生产环节所需的设施数量  
- **能耗统计**：汇总并显示整条生产链的总电力消耗  
- **分级组织**：按设施等级与依赖深度对生产步骤进行分组与排序，便于整体规划

---

### 📊 双视图展示模式

#### 表格视图
- 以表格形式完整展示生产线结构，支持按列排序  
- 显示物品产出速率、所需设施数量、当前选用配方及原料状态  
- 可通过下拉菜单快速切换配方  
- 一键将物品标记为“手动提供的原料”

#### 依赖树视图
- **交互式流程图**：以图形方式直观展示完整的生产依赖关系  
- **合并模式**：合并重复物品节点，显示汇总后的总需求  
- **拆分模式**：完整展示所有生产路径与依赖分支  
- **循环可视化**：对循环配方进行特殊渲染，使用反向连线指示回流关系  
- **层级布局**：按生产深度自动分层排布节点，提升可读性

---

### 🎨 手动供应链控制
- **将物品标记为原料**：在任意节点终止依赖展开  
- **灵活的来源规划**：适用于已有生产线、外部供应或阶段性规划  
- **快速切换**：可在生产表格中直接启用或取消手动供给

---

### 🌐 国际化支持
- 支持多语言界面

---

## 技术栈

- **前端框架**：React 18 + TypeScript  
- **构建工具**：Vite  
- **可视化**：React Flow（用于依赖树展示）  
- **UI 组件**：Radix UI 原语 + 自定义组件  
- **样式方案**：Tailwind CSS  
- **状态管理**：React Hooks（useState、useMemo、useCallback）  
- **国际化**：react-i18next

---

## 快速开始

### 在线使用（推荐）

直接访问  
**https://jamboChen.github.io/endfield-tool**  
即可在浏览器中使用，无需安装。

---

### 本地开发

如果你希望参与开发或在本地运行：

#### 安装步骤
```bash
# 克隆仓库
git clone https://github.com/JamboChen/endfield-tool.git
cd endfield-tool

# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev
````

---

## 数据来源与免责声明

* **数据来源**：所有物品、配方与设施数据均来自
  [endfield.wiki.gg](https://endfield.wiki.gg)
* **准确性说明**：计算结果基于当前 Wiki 数据，仅供参考。游戏机制或数值可能随版本更新而变化，请以游戏内实际情况为准。
* **社区维护**：数据准确性依赖于 Wiki 社区的维护。如发现错误，欢迎反馈或直接参与 Wiki 修正。

---

## 参与贡献

欢迎任何形式的贡献！请参阅 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详细规范。

---

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。

---

**说明**：本工具为玩家自制项目，与《明日方舟：终末地》官方无任何隶属或合作关系。
