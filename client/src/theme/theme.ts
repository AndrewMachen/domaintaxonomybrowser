import { createTheme } from "@mui/material/styles";
import { Level } from "../api/types";

/**
 * Level accents are the product's signature: each tier of the hierarchy owns a
 * fixed hue, so a node's depth is legible from its color alone — in the tree,
 * in chips, and on the detail rail. The hues read as a descending sequence
 * (violet → teal → amber → green) rather than an arbitrary set.
 */
export const LEVEL_COLOR: Record<Level, string> = {
  DomainGroup: "#6D5BD0",
  Domain: "#0E7C86",
  Subdomain: "#C2791F",
  DataProduct: "#3F8F5B",
};

export const LEVEL_TINT: Record<Level, string> = {
  DomainGroup: "rgba(109, 91, 208, 0.10)",
  Domain: "rgba(14, 124, 134, 0.10)",
  Subdomain: "rgba(194, 121, 31, 0.10)",
  DataProduct: "rgba(63, 143, 91, 0.10)",
};

export const INK = "#1B2430";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0E7C86", dark: "#0A5C63", light: "#3C97A0" },
    secondary: { main: "#6D5BD0" },
    error: { main: "#C2362F" },
    success: { main: "#3F8F5B" },
    warning: { main: "#C2791F" },
    background: { default: "#F4F6F8", paper: "#FFFFFF" },
    text: { primary: INK, secondary: "#5A6675" },
    divider: "rgba(27, 36, 48, 0.10)",
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    h1: { fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 600 },
    h2: { fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 600 },
    h3: { fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 600 },
    h6: { fontWeight: 600, letterSpacing: "-0.01em" },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiTooltip: {
      styleOverrides: { tooltip: { fontSize: 12, backgroundColor: INK } },
    },
  },
});
