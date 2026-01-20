# Endfield Calc — Production Chain Calculator for "Arknights: Endfield"

[中文](./README_zh.md)

[![Live Demo](https://img.shields.io/badge/🚀_Live_Demo-Try_Now-success?style=for-the-badge)](https://jamboChen.github.io/endfield-calc)
[![Discord](https://img.shields.io/badge/Discord-JOIN_US-5865F2?logo=discord&logoColor=white)](https://discord.gg/6V7CupPwb6)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

**Endfield Calc** is a production chain calculator for **Arknights: Endfield** that helps players plan resource requirements, production ratios, and facility needs—including circular production loops.

## Key Features

### 🎯 Core Functionality
- **Multi-target planning** with automatic dependency resolution
- **Smart recipe selection** with circular dependency handling
- **Real-time calculation** of facility counts and power consumption
- **Manual raw material marking** for flexible supply chain control

### 📊 Dual View Modes

#### Table View
- Comprehensive production breakdown with all metrics
- **Interactive hover**: Highlight upstream dependencies on mouse hover

![Table View Interaction](./img/table-hover-demo.gif)

#### Dependency Tree View
Two visualization modes for different planning needs:

**Recipe View**: Aggregates facilities by recipe type, shows total requirements
- Best for overall recipe optimization and material flow overview

**Facility View**: Shows each individual facility as a separate node
- Best for detailed capacity planning and load balancing
- Displays capacity utilization and precise material allocation

![Tree Views](./img/tree-comparison.gif)

Both modes feature interactive flow diagrams, cycle visualization, and flow rate labels.

## Technology Stack

- **Framework**: React 18 + TypeScript + Vite
- **Visualization**: React Flow with Dagre layout
- **UI**: Radix UI + Tailwind CSS
- **i18n**: react-i18next

## Getting Started

### Try Online
Visit **[https://jamboChen.github.io/endfield-calc](https://jamboChen.github.io/endfield-calc)**

### Local Development
```bash
git clone https://github.com/JamboChen/endfield-calc.git
cd endfield-calc
pnpm install
pnpm run dev
```

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE)

---

**Note**: Fan-made tool, not officially affiliated with Arknights: Endfield.
