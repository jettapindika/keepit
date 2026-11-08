---
version: alpha
name: Threads Light System
description: A clean, minimal social feed system with strong black-and-white contrast, subtle borders, and a single vivid blue accent.
colors:
  primary: "#1876F2"
  secondary: "#000000"
  tertiary: "#F5F5F5"
  neutral: "#FFFFFF"
  surface: "#FFFFFF"
  on-surface: "#000000"
  error: "#D92D20"
  border: "#00000026"
  muted-text: "#8E8E8E"
typography:
  headline-display:
    fontFamily: system-ui
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: 0px
  headline-lg:
    fontFamily: system-ui
    fontSize: 24px
    fontWeight: 600
    lineHeight: 25px
    letterSpacing: 0px
  headline-md:
    fontFamily: system-ui
    fontSize: 22px
    fontWeight: 600
    lineHeight: 25px
    letterSpacing: 0px
  headline-sm:
    fontFamily: system-ui
    fontSize: 20px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: 0px
  title-md:
    fontFamily: system-ui
    fontSize: 18px
    fontWeight: 600
    lineHeight: 22px
    letterSpacing: 0px
  body-lg:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0px
  body-md:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 400
    lineHeight: normal
    letterSpacing: 0px
  body-sm:
    fontFamily: system-ui
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0px
  label-lg:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0px
  label-md:
    fontFamily: system-ui
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0px
  label-sm:
    fontFamily: system-ui
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0px
  micro:
    fontFamily: system-ui
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: 0px
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 20px
  xl: 24px
  full: 9999px
spacing:
  xs: 6px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 56px
components:
  button-primary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.neutral}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    padding: "0px 16px"
    size: "200px"
    height: "95px"
  button-primary-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    padding: "0px 16px"
  button-secondary:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    padding: "0px 16px"
    size: "200px"
    height: "95px"
  button-tertiary:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: "0px"
  card:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "32px 24px 28px"
  input:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  modal:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "32px 24px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Threads Light System

## Overview
Threads feels minimal, confident, and highly utilitarian, with a social-product tone that stays out of the way of the content. The interface is spacious enough for reading long feeds, but dense enough to support navigation, social actions, and sign-in prompts without feeling cluttered. The overall emotional tone is calm and professional, with a single blue accent used to signal interaction and trust.

## Colors
- **Primary (#1876F2):** The bright Threads blue used for focus, links, and active states. It should remain the only vivid accent so the interface stays restrained and recognizable.
- **Secondary (#000000):** Pure black for brand marks, headings, icons, and primary button fills. This is the strongest contrast color in the system and anchors the visual hierarchy.
- **Tertiary (#F5F5F5):** A soft neutral gray used for card backgrounds and subtle tonal separation. It helps lift panels off the white page without introducing heavy shadows.
- **Neutral (#FFFFFF):** The base surface color for the app shell, modals, and button fills. White space is a core part of the Threads look and should dominate most containers.
- **Surface (#FFFFFF):** The default component surface, matching the app background for a clean, low-friction reading experience.
- **On-surface (#000000):** Primary text and icon color on light surfaces. Use this for body copy, labels, and interactive affordances.
- **Border (#00000026):** A very light translucent black used for dividers, card outlines, and button strokes. It keeps edges visible while preserving the soft, lightweight feel.
- **Muted-text (#8E8E8E):** Secondary text color for timestamps, helper text, and lower-emphasis instructions. It supports hierarchy without competing with the main content.

## Typography
The system uses system-ui as the core family, with the familiar fallbacks of platform sans-serif stacks for native, app-like rendering. Weight 600 is the workhorse for headings, navigation, and prominent labels, while 400 handles reading copy and helper text. Headlines are compact and tight in leading, reflecting a product-first interface rather than a decorative editorial one.

Use `headline-lg` through `headline-sm` for page titles and modal headlines, with `headline-display` reserved for larger promotional moments like onboarding. Body text should stay practical and readable using `body-lg`, `body-md`, and `body-sm`, with the medium size matching much of the feed copy. Labels use `label-md` and `label-sm` for buttons, nav items, and action rows; there is no visible uppercase or letter-spacing treatment, so text should remain sentence case and neutral.

## Layout
The layout is based on a fixed desktop three-column social-feed structure: left navigation, centered content stream, and a right rail for prompts and sign-in actions. Containers are narrow enough to keep reading comfortable, while the center feed remains the dominant column. Spacing rhythm is consistent and restrained, using the `xs` to `xl` scale to separate list rows, cards, and modal content without large ornamental gaps.

Section and card padding should feel generous but efficient: cards use 32px top padding, 24px horizontal padding, and 28px bottom padding, while modals add extra breathing room around the CTA stack. Vertical spacing between major sections should lean on `md` and `lg`, with `xl` reserved for page-level separation and large call-to-action blocks. The design favors alignment and containment over fluid, asymmetrical layouts.

## Elevation & Depth
Depth is intentionally minimal. Rather than heavy drop shadows, the interface relies on 1px borders, tonal panels, and contrast between white, off-white, and black. The modal is brought forward through a bright white surface and a crisp outlined button, not through dramatic shadow.

Cards read as lightly lifted via the `Border` token and a soft gray fill in `card`. This flat strategy keeps the product feeling clean, modern, and content-centric. If emphasis is needed, use color contrast or border weight before adding shadow.

## Shapes
The shape language is soft but not pill-heavy. Large interactive surfaces use 20px corner radii, while content cards and dialogs round up to 24px for a friendly, polished container feel. Smaller controls can remain modestly rounded or nearly square when the interaction is secondary.

Overall, the system balances friendliness and utility: buttons feel approachable, cards feel calm, and the UI avoids sharp geometry except where functional clarity requires it. Use `rounded.lg` for primary controls and `rounded.xl` for cards and modals.

## Components
Buttons are the most expressive component in the system. `button-primary` is a black-filled, high-contrast action with white text and a substantial footprint; it should be used for the main conversion action. `button-secondary` is the inverse: white fill, subtle border, black text, and the same large touch target. `button-tertiary` is text-only and should stay visually quiet for low-priority links or inline actions. Button text should use `label-md`, with generous horizontal padding and a very stable rectangular silhouette.

Cards use `card` with a light gray background, thin border, and roomy padding. They should group related content like prompts, post summaries, or onboarding blocks without introducing visual complexity. Keep internal spacing vertical and predictable, and avoid nested containers with competing borders.

Inputs should be white, bordered, and minimally styled, matching the app’s overall restraint. Focus states should use the primary blue rather than decorative glows. Placeholder text and helper text should stay muted so the field remains readable but unobtrusive.

Modals should use a clean white surface with rounded corners and centered content. The primary onboarding pattern is a stacked title, explanatory text, and a prominent CTA button. Keep close/dismiss controls minimal and unobtrusive.

Navigation items should be simple icon-plus-label rows with subtle active-state treatment. The active state can use a soft background tint or stronger weight, but should not rely on heavy fills or large shadows. Lists, feed rows, and action bars should remain compact, with clear icon spacing and consistent alignment across items.

## Do's and Don'ts
- Do keep the interface mostly white, black, and light gray, with blue reserved for emphasis and interaction.
- Do use system-ui and strong font weights for a native, app-like feel.
- Do prefer thin borders and tonal fills over heavy shadows or complex gradients.
- Do keep action buttons large, readable, and visually consistent across states.
- Don't introduce extra accent colors beyond the defined blue unless they are brand imagery.
- Don't use decorative typography treatments like uppercase labels or wide letter spacing.
- Don't over-round small utility controls; reserve the largest radii for cards, modals, and major buttons.
- Don't let content containers feel crowded; preserve generous padding and clear vertical rhythm.
