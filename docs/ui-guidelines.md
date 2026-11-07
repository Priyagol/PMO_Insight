# Arihant Workspace - UI Component Guidelines and Design System

> Source: architecture review approved on 2026-11-06. Update this document as the implementation evolves.

## 14. UI/UX design system

- **Tokens:** CSS variables, shadcn style, light and dark.
  - Sidebar: navy `#0B1426` (dark) / `#0F1B33`.
  - Surfaces: white / `#F7F8FA`; dark mode uses `#0B0F17` / `#121826`.
  - Primary blue `#2563EB`, accent violet `#7C3AED`.
  - Semantic colours: success `#16A34A`, warning `#D97706`, danger `#DC2626`, info `#0891B2`.
  - Chart palette: 8 colour-blind-safe hues, validated with the dataviz skill.
- **Type:** Inter (UI) + JetBrains Mono (IDs and numbers), 13–14 px base for density, tabular numerals in tables.
- **Shape and spacing:** radius 10 px for cards and 8 px for inputs, 4 px spacing grid, shadow-sm only, 1 px hairline borders.
- **Shell:** collapsible sidebar (grouped Workspace / Management / Automation / Admin, permission-filtered), top bar (breadcrumbs, global search, ⌘K palette, timer chip, notifications bell, theme toggle, profile).
- **Motion:** 150–200 ms ease-out for drawer, modal and list reorders; respects `prefers-reduced-motion`.
- **Patterns:** detail opens in a right-hand drawer (task) or a full page with tabs (project 360°); destructive actions use a confirm dialog; every data region has skeleton, empty, error and loaded states; Sonner toasts.

## Charts (Phase 5A)

- Categorical palette in fixed slot order, validated for colour-vision deficiency on the card surfaces. Light: `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #6250d6 #e34948`. Dark: `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`. Tokens `--chart-1` to `--chart-8`.
- Some light-mode slots are below 3:1 contrast, so every chart is built with `ChartCard` (`client/src/components/charts/chart-kit.tsx`), which always offers a table view.
- Status colours (`--status-good`, `--status-warning`, `--status-serious`, `--status-critical`) are never series colours and always appear with an icon and a label (`HealthBadge`, `SeverityBadge`).
- One value axis per chart; bars at most 24 px wide with 4 px rounded ends; 2 px lines; legend for two or more series; hover tooltips; filters in one row above the charts.
- Recharts loads only on pages that draw charts.
