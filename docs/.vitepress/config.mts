import { defineConfig } from "vitepress";

const repoUrl = "https://github.com/Ring-wdr/react-devtool-cli";

export default defineConfig({
  title: "react-devtool-cli",
  description: "Playwright-native CLI for inspecting live React apps without opening the DevTools UI.",
  base: "/react-devtool-cli/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["devtools-concept-mapping.md", "public-repo-strategy.md"],
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Workflows", link: "/workflows" },
      { text: "Architecture", link: "/architecture" },
      { text: "GitHub", link: repoUrl }
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Why RDT", link: "/" },
          { text: "Workflows", link: "/workflows" },
          { text: "Architecture", link: "/architecture" }
        ]
      }
    ],
    socialLinks: [{ icon: "github", link: repoUrl }],
    editLink: {
      pattern: `${repoUrl}/edit/main/docs/:path`,
      text: "Edit this page on GitHub"
    },
    search: {
      provider: "local"
    },
    footer: {
      message: "Playwright-native React inspection for agents and engineers.",
      copyright: "MIT Licensed"
    }
  }
});
