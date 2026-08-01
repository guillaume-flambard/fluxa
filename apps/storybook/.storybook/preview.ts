import type { Preview } from "@storybook/react";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "deep",
      values: [{ name: "deep", value: "#02060c" }],
    },
  },
};

export default preview;
