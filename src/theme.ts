import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/**
 * Warm earth palette (no blue / orange).
 * Source tokens from product palette.
 */
const config = defineConfig({
  globalCss: {
    "html, body": {
      margin: 0,
      minHeight: "100vh",
      color: "#f0ebe3",
      backgroundColor: "#090804",
      // Palette wash fixed to the bottom (dark top → earth colors low).
      backgroundImage: `linear-gradient(
        to bottom,
        #090804 0%,
        #0e0b0b 22%,
        #2d3038 36%,
        #4c565f 44%,
        #58767a 52%,
        #82907b 60%,
        #998862 68%,
        #74685b 78%,
        #6b6356 88%,
        #6b6356 100%
      )`,
      backgroundAttachment: "fixed",
      fontFamily: "body",
      lineHeight: "1.6",
    },
    "#root": {
      minHeight: "100vh",
      color: "#f0ebe3",
    },
    // Chakra Heading recipes default to dark fg — force readable ink.
    "h1, h2, h3, h4, h5, h6": {
      color: "#f0ebe3",
    },
  },
  theme: {
    tokens: {
      fonts: {
        body: {
          value:
            '"Space Grotesk", "Sora", "Inter", system-ui, -apple-system, sans-serif',
        },
        heading: {
          value:
            '"Space Grotesk", "Sora", "Inter", system-ui, -apple-system, sans-serif',
        },
        reading: {
          value: '"Georgia", "Times New Roman", serif',
        },
      },
      colors: {
        // Palette
        stoneGray: { value: "#6b6356" },
        warmTaupe: { value: "#74685b" },
        mutedGold: { value: "#998862" },
        sageGray: { value: "#82907b" },
        dustyTeal: { value: "#58767a" },
        slateBlue: { value: "#4c565f" },
        charcoal: { value: "#2d3038" },
        nearBlack: { value: "#0e0b0b" },
        warmBlack: { value: "#090804" },

        // Readable type on dark panels
        ink: { value: "#f0ebe3" },
        muted: { value: "#c4b8a8" },

        // Surfaces
        canvas: { value: "#090804" },
        accent: {
          DEFAULT: { value: "#998862" }, // muted-gold
          strong: { value: "#b5a57a" },
          soft: { value: "rgba(153, 136, 98, 0.28)" },
          mid: { value: "rgba(153, 136, 98, 0.18)" },
          border: { value: "rgba(153, 136, 98, 0.55)" },
        },
        secondary: {
          DEFAULT: { value: "#82907b" }, // sage
          soft: { value: "rgba(130, 144, 123, 0.22)" },
        },
        warning: { value: "#c4a574" },
        highlight: { value: "rgba(153, 136, 98, 0.92)" },
        panel: {
          soft: { value: "rgba(14, 11, 11, 0.88)" },
          strong: { value: "rgba(45, 48, 56, 0.92)" },
          glass: { value: "rgba(9, 8, 4, 0.9)" },
          raised: { value: "rgba(240, 235, 227, 0.06)" },
          raisedHover: { value: "rgba(240, 235, 227, 0.12)" },
        },
        border: {
          subtle: { value: "rgba(240, 235, 227, 0.1)" },
          muted: { value: "rgba(240, 235, 227, 0.16)" },
          strong: { value: "rgba(240, 235, 227, 0.28)" },
          soft: { value: "rgba(153, 136, 98, 0.35)" },
        },
      },
      radii: {
        pill: { value: "999px" },
        card: { value: "28px" },
        panel: { value: "24px" },
        control: { value: "14px" },
      },
      shadows: {
        glow: { value: "0 18px 40px rgba(9, 8, 4, 0.75)" },
        panel: {
          value:
            "inset 0 0 0 1px rgba(240, 235, 227, 0.04), 0 25px 40px rgba(9, 8, 4, 0.55)",
        },
        cardHover: { value: "0 10px 25px rgba(9, 8, 4, 0.45)" },
        tooltip: { value: "0 25px 50px rgba(9, 8, 4, 0.7)" },
      },
    },
    semanticTokens: {
      colors: {
        // Override Chakra defaults so Heading/Text stay light on dark UI.
        fg: {
          DEFAULT: { value: "{colors.ink}" },
          muted: { value: "{colors.muted}" },
        },
        bg: {
          DEFAULT: { value: "{colors.warmBlack}" },
          canvas: { value: "{colors.canvas}" },
          panel: { value: "{colors.panel.soft}" },
          glass: { value: "{colors.panel.glass}" },
          raised: { value: "{colors.panel.raised}" },
          subtle: { value: "{colors.charcoal}" },
        },
        ink: { value: "{colors.ink}" },
        muted: { value: "{colors.muted}" },
        "fg.accent": { value: "{colors.mutedGold}" },
        "fg.warning": { value: "{colors.warning}" },
        "border.subtle": { value: "{colors.border.subtle}" },
        "border.muted": { value: "{colors.border.muted}" },
        "border.strong": { value: "{colors.border.strong}" },
        border: {
          DEFAULT: { value: "{colors.border.subtle}" },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
