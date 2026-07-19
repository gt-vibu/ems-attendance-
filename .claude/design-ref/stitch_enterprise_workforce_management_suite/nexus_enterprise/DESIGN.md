---
name: Nexus Enterprise
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#002113'
  on-tertiary-container: '#009668'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-tabular:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 20px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

This design system is built for high-density information management with a focus on clarity, efficiency, and professional warmth. The brand personality is **Corporate Modern**: a blend of institutional reliability and contemporary digital agility. It targets HR professionals and team leads who require a tool that feels "at work" but reduces the cognitive load of complex data.

The aesthetic leans into **Minimalism** with subtle **Glassmorphism** for navigational elements. It prioritizes whitespace and structural alignment to ensure that employee records, payroll data, and performance metrics are the primary focus. The emotional response should be one of "controlled calm"—users should feel that the system is organized, predictable, and highly functional.

## Colors

The palette is anchored by **Deep Navy** (Primary), used for core navigation, headings, and high-emphasis states to establish authority. **Slate Gray** (Secondary) serves as the functional workhorse for secondary text, icons, and borders.

**Semantic Accents:**
- **Emerald Green (Success/Active):** Reserved strictly for "Active" employee statuses, completed tasks, and positive growth indicators.
- **Soft Amber (Warning/Pending):** Used for "Pending" approvals, upcoming reviews, or items requiring attention.
- **Slate 50 (Background):** Used for large surface areas to reduce eye strain compared to pure white.

Contrast ratios must adhere to WCAG 2.1 AA standards, particularly for data tables and status labels.

## Typography

The typography system utilizes **Inter** for its exceptional legibility in data-heavy environments. 

- **Scale:** High contrast between headlines and body text ensures a clear information hierarchy.
- **Tabular Numerals:** For all data tables, payroll figures, and ID numbers, use `font-variant-numeric: tabular-nums` to ensure vertical alignment of digits.
- **Labels:** Small labels use a slightly increased letter spacing and semi-bold weight to remain legible even at 12px.

## Layout & Spacing

This design system employs a **Fluid Grid** model with a maximum content width of 1440px. 

- **Desktop (1024px+):** 12-column grid, 24px gutters, 32px side margins. Sidebars are fixed at 280px.
- **Tablet (768px - 1023px):** 8-column grid, 20px gutters, 24px side margins. Sidebars collapse into an icon-only rail or a hamburger menu.
- **Mobile (<767px):** 4-column grid, 16px gutters, 16px side margins. Vertical stacking is mandatory for all card-based layouts.

Spacing follows a 4px baseline rhythm. Generous padding (16px - 24px) is applied inside containers to prevent "data claustrophobia."

## Elevation & Depth

Depth is conveyed through **Tonal Layers** and **Ambient Shadows** to create a structured workspace.

- **Level 0 (Background):** `#F8FAFC`. The lowest plane.
- **Level 1 (Cards/Surface):** White `#FFFFFF` with a 1px border of `#E2E8F0`. 
- **Level 2 (Dropdowns/Modals):** White with a soft, diffused shadow: `0px 10px 15px -3px rgba(15, 23, 42, 0.08)`.
- **Active State:** A subtle inner shadow or a 2px colored border (Primary or Tertiary) indicates focus or selection.

Avoid heavy black shadows; instead, use the Primary Navy color at very low opacities (5-10%) to tint shadows for a more organic, integrated look.

## Shapes

The shape language is **Rounded**, striking a balance between corporate precision and modern approachability. 

- **Standard Elements:** Buttons, input fields, and small cards use a 0.5rem (8px) radius.
- **Large Containers:** Main content areas and modals use 1rem (16px) to soften the overall interface.
- **Data Indicators:** Status chips (Active/Pending) use 1.5rem (24px) or full pill shapes to distinguish them from interactive buttons.

## Components

### Buttons
- **Primary:** Deep Navy background, white text. 8px radius. High-contrast hover state (Slate 800).
- **Secondary:** Transparent background, Slate 200 border, Navy text.
- **Touch Targets:** Minimum 44x44px for all mobile interactive elements.

### Status Chips
- Semi-transparent background of the semantic color (e.g., Emerald 10%) with opaque text. Pill-shaped. Used for "Active", "On Leave", or "Probation".

### Input Fields
- 1px Slate 200 border. On focus, the border transitions to Primary Navy with a 2px soft outer glow. Labels are always persistent above the field.

### Data Tables
- Row height of 56px to provide "breathing room."
- Subtle Slate 50 zebra-striping or a bottom border of 1px Slate 100.
- Column headers in `label-sm` style.

### Cards
- White background, 8px radius, 1px Slate 200 border. No shadow unless the card is "hovered" or "active."

### Profile Avatars
- Circular for individual employees. Squares with 4px radius for departments or teams. High-resolution imagery required; fallback to Navy initials.