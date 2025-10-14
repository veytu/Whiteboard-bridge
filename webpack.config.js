/**
 * @type {import('webpack').Configuration}
 */

const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const TerserJSPlugin = require('terser-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const { DefinePlugin } = require('webpack');

config = {
  entry: './src/index',
  output: {
    path: path.join(__dirname, '/build'),
    filename: `[name].[contenthash:8].js`
  },
  target: ["web", "es5"],
  resolve: {
    alias: {
      "@netless/window-manager/dist/style.css": require.resolve("@netless/window-manager").replace("index.js", "style.css"),
      "@netless/window-manager": require.resolve("@netless/window-manager"),

      "@netless/appliance-plugin/dist/style.css": require.resolve("@netless/appliance-plugin").replace("appliance-plugin.js", "style.css"),
      "@netless/appliance-plugin/dist/subWorker.js": require.resolve("@netless/appliance-plugin").replace("appliance-plugin.js", "subWorker.js"),
      "@netless/appliance-plugin/dist/fullWorker.js": require.resolve("@netless/appliance-plugin").replace("appliance-plugin.js", "fullWorker.js"),
      "@netless/appliance-plugin": require.resolve("@netless/appliance-plugin"),
      
      "@wukong/custom-packages/dist/style.css": require.resolve("@wukong/custom-packages").replace("custom-packages.js", "style.css"),
      "@wukong/custom-packages": require.resolve("@wukong/custom-packages"),
    },
    extensions: ['.ts', '.tsx', '.js', "cjs"],
    fallback: {
      buffer: "buffer",
    }
  },
  optimization: {
    minimizer: [new TerserJSPlugin({extractComments: false, parallel: true}), new CssMinimizerPlugin({})],
    moduleIds: 'deterministic',
    runtimeChunk: 'single',
    splitChunks: {
      chunks: "all",
      cacheGroups: {
        white: {
          test: /[\\/]node_modules[\\/](white-web-sdk)[\\/]/,
          name: 'web-sdk',
          chunks: 'all',
          priority: 10,
          reuseExistingChunk: true
        },
        video: {
          test: /video/,
          name: 'video',
          chunks: 'all',
          priority: 7,
          reuseExistingChunk: true
        },
        netless: {
          test: /@netless/,
          name: 'netless',
          chunks: 'all',
          priority: 7,
          reuseExistingChunk: true
        },
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendor',
          chunks: 'all',
          priority: 1,
          reuseExistingChunk: true
        }
      }
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
    new CleanWebpackPlugin(),
    new HtmlWebpackPlugin({
      template: './src/index.html'
    }),
    new MiniCssExtractPlugin()
  ],
  module: {
    rules: [
      {
        test: /\.(ts|js|cjs)x?$/,
        resourceQuery: { not: [/raw/] },
        exclude: function(modulePath) {
          // 排除 node_modules，但保留需要转译的包
          if (/node_modules/.test(modulePath)) {
            // 明确包含需要转译为 ES5 的包
            return !/@wukong\/custom-packages/.test(modulePath);
          }
          return false;
        },
        use: [
          "thread-loader",
          'babel-loader',
        ],
      },
      {
        test: /\.css$/,
        use: [{loader: MiniCssExtractPlugin.loader}, 'css-loader']
      },
      {
        test: /\.(svg|png)/,
        use: ['file-loader']
      },
      {
        resourceQuery: /raw/,
        type: 'asset/source',
      }
    ],
    unknownContextCritical: false,
  },
  cache: {
    type: "filesystem",
    // 手动修改 node_modules 缓存不会失效。可以通过手动修改 config 或者删除 .cache 文件来触发，同时观察文件名是否有变化。
    buildDependencies: {
      config: [__filename],
    },
  }
};

module.exports = (env, argv) => {
  if (argv.mode === 'development') {
    config.output.filename = '[name].[hash].js';
    // 开发模式下也需要保持对 @wukong/custom-packages 的转译
    config.module.rules[0].exclude = function(modulePath) {
      if (/node_modules/.test(modulePath)) {
        return !/@wukong\/custom-packages/.test(modulePath);
      }
      return false;
    };
  }
  config.plugins.push(new DefinePlugin({
    'process.env.NODE_ENV': JSON.stringify(argv.mode),
    'process.env.DEBUG': argv.mode === "development"
  }))
  return config;
}