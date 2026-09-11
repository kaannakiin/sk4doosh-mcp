import { createTheme } from "@mantine/core";

const SANS = "'Instrument Sans', 'Helvetica Neue', Arial, sans-serif";

const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export const theme = createTheme({
  primaryColor: "signal",
  primaryShade: { light: 6, dark: 5 },
  defaultRadius: 0,
  fontFamily: SANS,
  fontFamilyMonospace: MONO,
  headings: { fontFamily: SANS, fontWeight: "600" },
  colors: {
    signal: [
      "#eef0ff",
      "#dadeff",
      "#b1b8ff",
      "#858ffe",
      "#6169fd",
      "#4a4ffd",
      "#3f42fe",
      "#3235e3",
      "#2a2ecb",
      "#1e21b2",
    ],
  },
});
