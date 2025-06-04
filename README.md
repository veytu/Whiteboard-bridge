# white-sdk-bridge![build](https://github.com/netless-io/whiteboard-bridge/actions/workflows/tsc.yml/badge.svg)

## 介绍

基于 dsbridge 将 [white-web-sdk](https://www.npmjs.com/package/white-web-sdk) 封装成 Android iOS 可用，且 API 一致的 web 页面。

1. iOS 端使用[DSBridge-iOS](https://github.com/wendux/DSBridge-IOS)。
1. Android 端使用[DSBridge-Android](https://github.com/wendux/DSBridge-Android)。

> white-web-sdk 使用见[文档](https://developer.netless.link/)

## 使用

本项目编译出的文件，会被整体打包进 white-sdk 对应的 native 端中，作为 native sdk 需要的桥接。一般情况下，并不会被直接使用。

## 使用约定

### 1. 时间单位

在本项目中，时间单位都与 js 习惯保持一致，使用毫秒为单位；iOS 习惯为秒，在 iOS 侧进行转换。

### DSBridge 使用

`dsBridge.registerAsyn`方法中，不使用`Promise`，使用`.then()`写法。
`dsBridge`的注册方法：`dsBridge.register`，`dsBridge.registerAsyn`区分命名空间。
没有异步的 API，除遗留问题外，尽可能使用`dsBridge.register`注册。

## TODO

- [ ] 由于 promise then/catch 模式，出现内部错误时，没有进入 catch 回调的问题，需要更改为 await/async 写法，并通过测试。

## 发布流程

- 该库是移动端库的上层封装，需要注意的是，任何依赖更新，都不应该修改 yarn-lock.json 当中的其它依赖版本，否则会造成兼容性问题，这也就意味着每次 yarn upgrade 某个版本的时候，需要保证其它依赖不变，特别是在升级 window-manager 的时候，需要先将升级后的 window-manager 的版本保存下来，然后撤销 git 的所有变更，并手动替换 yarn-lock 的内容，之后删除本地 node_modules，重新 yarn，实现 window-manager 的更新；
- 特别注意，仅该 repo 使用 yarn
- 通过该库的构建，将构建产物分别加入到 whiteboard-Ios 及 whiteboard-android 中，实现双端的更新；
- 安卓/IOS 端的构建产物分别放在以下目录下：
  - Android: `whiteboard-android/sdk/src/main/assets/whiteboard`
  - iOS: `Whiteboard-iOS/Whiteboard/Resource`
