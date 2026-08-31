import { defineConfig } from "@tarojs/cli";
import type { IProjectConfig } from "@tarojs/taro/types/compile";

import devConfig from "./dev";
import prodConfig from "./prod";

type WebpackMerge = (...configs: Array<object | null | undefined>) => IProjectConfig<"webpack5">;

export default defineConfig<"webpack5">(async (merge: WebpackMerge) => {
  const baseConfig: IProjectConfig<"webpack5"> = {
    projectName: "couju-miniapp",
    date: "2026-08-31",
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2,
    },
    sourceRoot: "src",
    outputRoot: "dist",
    framework: "react",
    compiler: "webpack5",
    plugins: [],
    copy: { patterns: [], options: {} },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        url: { enable: true, config: { limit: 1024 } },
        cssModules: { enable: false, config: { namingPattern: "module", generateScopedName: "[name]__[local]___[hash:base64:5]" } },
      },
    },
    h5: {
      postcss: {
        autoprefixer: { enable: true, config: {} },
        cssModules: { enable: false, config: { namingPattern: "module", generateScopedName: "[name]__[local]___[hash:base64:5]" } },
      },
    },
  };

  return process.env.NODE_ENV === "development"
    ? merge({}, baseConfig, devConfig)
    : merge({}, baseConfig, prodConfig);
});
