import { AppProxy, WindowManager } from "@netless/window-manager";
import {
  getScenePathRoleInfo,
  UserOptionsUtils,
  WkCustomAppManager,
  WkCustomTeleBoxManager,
  WKWindowManagerStore,
} from "@wukong/custom-packages";
import type { WKWindowManagerStoreOptionsFuncs } from "@wukong/custom-packages";
import { call, asyncCall } from "..";
import { logger } from "../../utils/Logger";
import "./index.css";

// 声明全局变量类型
declare const __PACKAGE_INFO__: {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * 白板窗口管理器桥接
 */
export class WKWindowManagerStoreBridge {
  /**
   * 白板窗口管理器
   */
  public wkWindowManagerStore: WKWindowManagerStore | undefined = undefined;

  /**
   * 窗口管理器选项函数
   */
  public wkWindowManagerStoreOptionsFuncs: WKWindowManagerStoreOptionsFuncs = {
    sendTaskEvent: (_key: string, _state: number) => {},
    setIsTalkativeOpening: (_val: boolean) => {},
    onTalkativeLocalMessage: (_appId: string, event: Record<string, any>) => {
      logger("talkativeOnLocalMessage", event);
      const { data } = event;
      if (data && (data as any)?.cwd) {
        this.sendMessageToNative(
          NativeWebBridgeMethod.receiveTalkActiveInfo,
          data
        );
      }
    },
    getTalkativeInfoSync: async (configInfo: string) => {
      return this.receiveMessageFromNative(
        NativeWebBridgeMethod.getTalkativeInfoSync,
        configInfo
      );
    },
    getCurrentScenePathBackground: (_scenePath?: string) => {
      return { color: "#fff", imageUrl: "" };
    },
    updateWhiteBoardSizeInfo: (
      _width: number,
      _height: number,
      _scale: number
    ) => {},
    getFirstSetWhiteBoardSizeInfo: () => {
      return { width: 0, height: 0, scale: 0 };
    },
    mainViewPageInfo: () => {
      return { showIndex: 0, count: 1 };
    },
    mainViewNextPage: () => {},
    mainViewPrevPage: () => {},
    mainViewAddPage: () => {},
    /**
     * 应用关闭
     * @param closedAppId 关闭的appId
     * @param appInfo 应用信息
     */
    onAppClose: (closedAppId: string, appInfo: AppProxy | undefined) => {
      console.info("onAppClose", closedAppId, appInfo);
      if (closedAppId.toLowerCase().includes("talkative")) {
        this.sendMessageToNative(NativeWebBridgeMethod.onTalkativeClose, {
          appId: closedAppId,
        });
      }
    },
    onAppSetup: (appId: string, appInfo: AppProxy) => {
      console.info("onAppSetup", appId, appInfo);
    },
    onWindowManagerInit: (windowManger: WindowManager) => {
      window.manager = windowManger;
      windowManger.emitter.on("onMainViewMounted", () => {
        if (this.wkWindowManagerStore) {
          this.wkWindowManagerStore.destroy();
          this.wkWindowManagerStore = undefined;
          this._initWKWindowManagerStore();
        }
        this.wkWindowManagerStore?.initial();
        this.sendMessageToNative(NativeWebBridgeMethod.onMainViewMounted, {});
        this.onWriteChangeListener(windowManger.room.isWritable);
        windowManger.emitter.off("onMainViewMounted", () => {});
      });
    },
    setReceivePostMessageFun: function (
      _func: (message: unknown) => void
    ): void {
      //@ts-ignore
      window.postMessageToTalkActive = _func;
    },
  };

  constructor() {
    // 打印版本和依赖信息
    this._printVersionInfo();

    UserOptionsUtils.setCheckPermissionCallback((permission?: string[]) => {
      return new Promise(async (resolve) => {
        const result = await this.receiveMessageFromNative(
          NativeWebBridgeMethod.getHavePermission,
          permission
        );
        if (result + "" === "true") {
          resolve(true);
          this.customShowLog("getHavePermission", permission, result, "");
        } else {
          resolve(false);
          this.customShowLog("getHavePermission", permission, result, "");
        }
      });
    });
    UserOptionsUtils.setGetCurrentUserInfoCallback(() => {
      return this.receiveMessageFromNative(
        NativeWebBridgeMethod.getCurrentUserInfo,
        JSON.stringify({})
      ) as Promise<any>;
    });
    this.receiveMessageFromNative(NativeWebBridgeMethod.getShowTextContent, [
      "whiteboard.error.textIsOtherEdited",
      "error.courseware.limit.length",
      "error.courseware.img.limit.length",
      "loading",
      "whiteboard.error.longPencil",
    ]).then((text) => {
      UserOptionsUtils.setShowTextContent(JSON.parse(text as string));
    });
    UserOptionsUtils.setIsTeacherCallback(() => {
      return new Promise(async (resolve) => {
        const result = await this.receiveMessageFromNative(
          NativeWebBridgeMethod.getIsTeacher,
          JSON.stringify({})
        );
        if (result + "" === "true") {
          resolve(true);
          this.customShowLog("getIsTeacher", result, "");
        } else {
          resolve(false);
          this.customShowLog("getIsTeacher", result, "");
        }
      });
    });
    this.customShowLog("初始化UserOptionsUtils完成");

    this._initWKWindowManagerStore();
    this.customShowLog("开始注册WKWindowManager");
    // WKWindowManagerStore.registerAll(this._wkWindowManagerStoreOptionsFuncs)
    this.customShowLog(
      "注册WKWindowManager完成，开始初始化WKWindowManagerStore"
    );
  }

  private _initWKWindowManagerStore() {
    this.wkWindowManagerStore = new WKWindowManagerStore(
      () => {
        return window.manager as WindowManager;
      },
      (isInitialized: boolean) => {
        this.customShowLog(
          `初始化WKWindowManagerStore完成，isInitialized: ${isInitialized}`
        );
        if (isInitialized) {
          this.registerListenerAll();
        }
      }
    );
    this.customShowLog("初始化WKWindowManagerStore完成");
    //设置白板打开课件的筛选条件
    this.wkWindowManagerStore?.setFilterAppsFun((app: AppProxy) => {
      if (app) {
        if (
          app.kind == "Slide" ||
          app.kind == "Presentation" ||
          app.kind == "Plyr"
        ) {
          const info = getScenePathRoleInfo(app.scenePath);
          if (info) {
            return {
              mainId: info.id,
              name: "",
              fileType: info.fileExt,
            };
          }
        }
      }
      return undefined;
    });
  }

  /**
   * 监听焦点缩放比例
   */
  private onBoxChangeListener = (data: {
    maxMaxTopBox?: any;
    maxNomalTopBox?: any;
  }) => {
    this.customShowLog("onBoxChangeListener", data);
    this.customShowLog(
      `监听焦点缩放比例，data: ${data.maxMaxTopBox} , ${data.maxNomalTopBox}`
    );
  };

  /**
   * 监听缩放比例
   */
  private onScaleChangeListener = (appId: string, _ratio: number) => {
    this.customShowLog("onScaleChangeListener", appId, _ratio);
    this.customShowLog(`监听缩放比例，appId: ${appId}, _ratio: ${_ratio}`);
  };

  /**
   * 监听页面变化
   */
  private onPageChangeListener = (_appId: string, _scenePath: string) => {
    this.customShowLog("onPageChangeListener", _appId, _scenePath);
    this.customShowLog(
      `监听页面变化，_appId: ${_appId}, _scenePath: ${_scenePath}`
    );
  };

  /**
   * 监听教具状态变化
   * @param memberState 教具状态
   */
  private onMemberStateChangeListener = (memberState: any) => {
    this.customShowLog("onMemberStateChangeListener", memberState);
    this.customShowLog(
      `监听教具状态变化，memberState: ${JSON.stringify(memberState)}`
    );
    this.sendMessageToNative(
      NativeWebBridgeMethod.onMemberStateChange,
      memberState
    );
  };

  /**
   * 监听激光笔激活状态变化
   * @param active 激活状态
   */
  private onLaserPointerActiveChangeListener = (active: boolean) => {
    this.customShowLog("onLaserPointerActiveChangeListener", active);
    this.customShowLog(`监听激光笔激活状态变化，active: ${active}`);
  };

  /**
   * 监听书写状态变化
   * @param isWriting 是否正在书写
   */
  private onWriteChangeListener = (isWriting: boolean) => {
    this.customShowLog(`监听可写权限改变监听: ${isWriting}`);
    this.sendMessageToNative(
      NativeWebBridgeMethod.onWriteChangeStateChange,
      isWriting
    );
  };

  /**
   * 注册所有监听
   */
  public registerListenerAll() {
    this.wkWindowManagerStore?.classListManager?.addBoxChangeListener(
      this.onBoxChangeListener
    );
    this.wkWindowManagerStore?.scaleManager?.addScaleChangeListener(
      this.onScaleChangeListener
    );
    this.wkWindowManagerStore?.addPageChangeListener(this.onPageChangeListener);
    this.wkWindowManagerStore?.addMemberStateChangeListener(
      this.onMemberStateChangeListener
    );
    this.wkWindowManagerStore?.addWriteChangeStateChangeListener(
      this.onWriteChangeListener
    );
    this.wkWindowManagerStore?.laserPointerManager?.addCallbackActiveListener(
      this.onLaserPointerActiveChangeListener
    );
    this.onBoxChangeListener({
      maxMaxTopBox: undefined,
      maxNomalTopBox: undefined,
    });
  }

  /**
   * 移除所有监听
   */
  public unregisterListenerAll() {
    this.wkWindowManagerStore?.classListManager?.removeBoxChangeListener(
      this.onBoxChangeListener
    );
    this.wkWindowManagerStore?.scaleManager?.removeScaleChangeListener(
      this.onScaleChangeListener
    );
    this.wkWindowManagerStore?.removePageChangeListener(
      this.onPageChangeListener
    );
    this.wkWindowManagerStore?.removeMemberStateChangeListener(
      this.onMemberStateChangeListener
    );
    this.wkWindowManagerStore?.removeWriteChangeStateChangeListener(
      this.onWriteChangeListener
    );
    this.wkWindowManagerStore?.laserPointerManager?.removeCallbackActiveListener(
      this.onLaserPointerActiveChangeListener
    );
  }

  /**
   * 自定义显示日志
   * @param method 方法名
   * @param data 数据
   * @param result 结果
   * @param error 错误
   */
  public customShowLog(...optionalParams: any[]) {
    console.log(`[WhiteboardOptions] [WhiteBoardBridge]`, ...optionalParams);
  }

  /**
   * 打印版本和依赖信息
   */
  private _printVersionInfo() {
    try {
      // 构建版本信息对象
      const versionInfo: any = {
        packageName: "whiteboard-bridge",
        timestamp: new Date().toISOString(),
      };

      // 从构建时注入的全局变量获取 package.json 信息
      if (typeof __PACKAGE_INFO__ !== "undefined") {
        const packageInfo = __PACKAGE_INFO__;
        versionInfo.packageVersion = packageInfo.version;
        versionInfo.dependencies = packageInfo.dependencies || {};
        versionInfo.devDependencies = packageInfo.devDependencies || {};

        // 统计信息
        versionInfo.statistics = {
          totalDependencies: Object.keys(versionInfo.dependencies).length,
          totalDevDependencies: Object.keys(versionInfo.devDependencies).length,
          totalPackages:
            Object.keys(versionInfo.dependencies).length +
            Object.keys(versionInfo.devDependencies).length,
        };

        // 详细的包列表
        versionInfo.detailedPackages = {
          dependencies: this._formatPackageList(versionInfo.dependencies),
          devDependencies: this._formatPackageList(versionInfo.devDependencies),
        };
      }

      // 使用 console.info 打印一条完整的版本信息
      console.info(
        "[WhiteboardOptions] Current Version Info",
        "whiteboard-bridge",
        JSON.stringify(versionInfo.packageVersion)
      );
      console.info(
        "[WhiteboardOptions] Current Version Info",
        "whiteboard-bridge",
        JSON.stringify(versionInfo.dependencies)
      );
      console.info(
        "[WhiteboardOptions] Current Version Info",
        "whiteboard-bridge",
        JSON.stringify(versionInfo.devDependencies)
      );
      console.info(
        "[WhiteboardOptions] Current Version Info",
        "whiteboard-bridge",
        JSON.stringify(versionInfo.statistics)
      );
      console.info(
        "[WhiteboardOptions] Current Version Info",
        "whiteboard-bridge",
        JSON.stringify(versionInfo.detailedPackages)
      );
    } catch (error) {
      console.error(
        "Current Version Info",
        "whiteboard-bridge",
        "Error:",
        JSON.stringify(error)
      );
    }
  }

  /**
   * 格式化包列表为数组格式
   */
  private _formatPackageList(
    packages: Record<string, string>
  ): Array<{ name: string; version: string }> {
    return Object.entries(packages).map(([name, version]) => ({
      name,
      version,
    }));
  }

  /**
   * 发送消息给原生
   * @param method 方法名
   * @param data 数据
   */
  public sendMessageToNative = async (
    method: NativeWebBridgeMethod,
    data?: any
  ) => {
    try {
      this.customShowLog("sendMessageToNative", method, "start", data);
      call(
        `wuKongOptions.sendMessageToNative`,
        JSON.stringify({ method, data })
      );
    } catch (error) {
      this.customShowLog(
        "sendMessageToNativeError",
        method,
        "error",
        data,
        error
      );
    }
  };
  /**
   * 接收消息来自原生
   * @param data 数据
   */
  public receiveMessageFromNative = async (
    method: NativeWebBridgeMethod,
    data: any
  ) => {
    let result = "";
    try {
      this.customShowLog("receiveMessageFromNative", method, "start", data);
      result = await (asyncCall(
        `wuKongOptions.getInfoSync`,
        JSON.stringify({ method, data: data })
      ) as Promise<string>);
      this.customShowLog(
        "receiveMessageFromNativeResult",
        method,
        "end",
        data,
        result
      );
      return result;
    } catch (error) {
      this.customShowLog(
        "receiveMessageFromNativeError",
        method,
        "error",
        data,
        error
      );
    }
    return new Promise((resolve) => {
      resolve(result);
    });
  };
}
/**
 * 原生 web 桥接方法
 */
export enum NativeWebBridgeMethod {
  /**
   * 接收 talkative 消息发送给原生
   * 参数：data
   *
   */
  receiveTalkActiveInfo = "receiveTalkActiveInfo",

  /**
   * 获取talkative同步信息
   * 参数：configInfo
   *
   */
  getTalkativeInfoSync = "getTalkativeInfoSync",

  /**
     * 监听到互动题关闭事件发送到原生
     * 参数：{
          appId: closedAppId,
          appInfo: appInfo,
        }
     */
  onTalkativeClose = "onTalkativeClose",

  /**
   * 监听到主视图挂载事件发送到原生
   * 参数：{}
   */
  onMainViewMounted = "onMainViewMounted",

  /**
   * 获取是否有权限
   * 参数：permission
   * 返回：boolean
   */
  getHavePermission = "getHavePermission",

  /**
   * 获取当前用户信息
   * 返回：{
   * userId: string,
   * userName: string,
   * userRole: string,
   * }
   */
  getCurrentUserInfo = "getCurrentUserInfo",
  /**
   * 获取显示文字内容
   * 参数：['whiteboard.error.textIsOtherEdited', 'error.courseware.limit.length',
   * 'error.courseware.img.limit.length', 'loading', 'whiteboard.error.longPencil']
   * 返回：{
   * 'whiteboard.error.textIsOtherEdited': 'text',
   * 'error.courseware.limit.length': 'text',
   * 'error.courseware.img.limit.length': 'text',
   * 'loading': 'text',
   * 'whiteboard.error.longPencil': 'text',
   * }
   */
  getShowTextContent = "getShowTextContent",

  /**
   * 获取是否是老师
   * 参数：{}
   * 返回：boolean
   */
  getIsTeacher = "getIsTeacher",

  // /**
  //  * 控制台日志
  //  * 参数：{
  //  * message: string,
  //  * }
  //  */
  // consoleLog = "consoleLog",
  /**
   * 监听教具状态变化
   * 参数：memberState
   */
  onMemberStateChange = "onMemberStateChange",

  /**
   * 监听书写状态变化
   * 参数：isWriting
   */
  onWriteChangeStateChange = "onWriteChangeStateChange",
}
