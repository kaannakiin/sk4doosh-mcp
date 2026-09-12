import { createTheme, Loader, LoadingOverlay } from "@mantine/core";

const SANS = "'Public Sans', ui-sans-serif, system-ui, sans-serif";

const SERIF = "'Newsreader', ui-serif, Georgia, 'Times New Roman', serif";

const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export const theme = createTheme({
  primaryColor: "verdigris",
  primaryShade: { light: 7, dark: 4 },
  defaultRadius: "md",
  fontFamily: SANS,
  fontFamilyMonospace: MONO,
  components: {
    Loader: Loader.extend({
      defaultProps: {
        type: "bars",
      },
    }),
    LoadingOverlay: LoadingOverlay.extend({
      defaultProps: {
        loaderProps: {
          type: "bars",
        },
      },
    }),
  },
  headings: { fontFamily: SERIF, fontWeight: "500" },
  radius: { sm: "6px", md: "10px", lg: "14px" },
  colors: {
    verdigris: [
      "#eef5f4",
      "#dbe9e7",
      "#b6d3cf",
      "#8dbab5",
      "#69a49e",
      "#4f938c",
      "#3d8079",
      "#2c6763",
      "#1f5f5b",
      "#153f3d",
    ],
  },
});
