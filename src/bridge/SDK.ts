import { hookCreateElement } from '../utils/ImgError';
import { CursorTool } from "@netless/cursor-tool";
import { asyncCall, call, registerAsyn } from '.';
import { NativeSDKConfig, NativeJoinRoomParams, NativeReplayParams, AppRegisterParams, NativeSlideAppOptions } from "@netless/whiteboard-bridge-types";
import { WhiteWebSdk, Room, Player, createPlugins, PlayerPhase, setAsyncModuleLoadMode, AsyncModuleLoadMode } from "white-web-sdk";
import { videoPlugin } from "@netless/white-video-plugin";
import { audioPlugin } from "@netless/white-audio-plugin";
import { videoPlugin2 } from "@netless/white-video-plugin2";
import { audioPlugin2 } from "@netless/white-audio-plugin2";
import { videoJsPlugin } from "@netless/video-js-plugin";
import SlideApp, { addHooks as addHooksSlide, usePlugin } from "@netless/app-slide";
import Talkative from '@netless/app-talkative'
import { EffectPlugin, MixingPlugin } from '@netless/slide-rtc-plugin';
import { AppProxy, MountParams, WindowManager } from "@netless/window-manager";
import { SyncedStorePlugin } from "@netless/synced-store";
import { IframeBridge, IframeWrapper } from "@netless/iframe-bridge";
import AppIframeBridge from '@netless/app-iframe-bridge';
import { logger, enableReport } from "../utils/Logger";
import { convertBound } from "../utils/BoundConvert";
import { addManagerListener, createAppState } from "./Manager";
import { RoomCallbackHandler } from "../native/RoomCallbackHandler";
import { addBridgeLogHook, createPageState } from "../utils/Funs";
import { lastSchedule, ReplayerCallbackHandler, ReplayerCallbackHandlerImp } from "../native/ReplayerCallbackHandler";
import CombinePlayerFactory from "@netless/combine-player";
import { registerBridgeRoom } from "./Room";
import { registerPlayerBridge } from "./Player";
import { RtcAudioMixingClient } from '../RtcAudioMixingClient';
import { SDKCallbackHandler } from '../native/SDKCallbackHandler';
import { destroySyncedStore, initSyncedStore } from './SyncedStore'
import { SlideLoggerPlugin } from '../utils/SlideLogger';
import { RtcAudioEffectClient } from '../RtcAudioEffectClient';
import { prepare } from '@netless/white-prepare';

import { ApplianceMultiPlugin } from '@netless/appliance-plugin';
import fullWorkerString from '@netless/appliance-plugin/dist/fullWorker.js?raw';
import subWorkerString from '@netless/appliance-plugin/dist/subWorker.js?raw';

import { PCMProxy } from '../PCMProxy';
import Plyr from '@netless/app-plyr';
import { getScenePathRoleInfo, UserOptionsUtils, WkCustomAppManager, WkCustomTeleBoxManager, WKWindowManagerStore, WKWindowManagerStoreOptionsFuncs } from '@wukong/custom-packages';

interface ExtraNativeJoinRoomParams {
    appliancePluginOptions?: Record<string, any>;
}

let sdk: WhiteWebSdk | undefined = undefined;
let room: Room | undefined = undefined;
let player: Player | undefined = undefined;

let nativeConfig: NativeSDKConfig | undefined = undefined;
let cursorAdapter: CursorTool | undefined = undefined;

export const sdkCallbackHandler = new SDKCallbackHandler();

let divRef: () => (HTMLElement | undefined);

const textareaCSSId = "whiteboard-native-css"
const nativeFontFaceCSS = "whiteboard-native-font-face";

setAsyncModuleLoadMode(AsyncModuleLoadMode.StoreAsBase64);

export function setWhiteboardDivGetter(aGetter: () => (HTMLElement)) {
    divRef = aGetter;
}

const sdkNameSpace = "sdk";

export function registerSDKBridge() {
    const sdk = new SDKBridge();
    registerAsyn(sdkNameSpace, sdk);
    (window as any).newWhiteSdk = sdk.newWhiteSdk;
    (window as any).joinRoom = sdk.joinRoom;
    (window as any).replayRoom = sdk.replayRoom;
    addBridgeLogHook([sdkNameSpace], logger);
}

function removeBind() {
    if (window.manager) {
        window.manager.destroy()
        window.manager = undefined;
        room = undefined;
        player = undefined;
    } else if (room) {
        room.bindHtmlElement(null);
        // FIXME:最好执行 disconnect，但是由于如果主动执行 disconnect，会触发状态变化回调，导致一定问题，所以此处不能主动执行。
        room = undefined;
    } else if (player) {
        player.bindHtmlElement(null);
        player = undefined;
    }
    if (window.syncedStore) {
        destroySyncedStore();
    }
}

async function mountWindowManager(room: Room, handler: RoomCallbackHandler | ReplayerCallbackHandler, windowParams?: Omit<Omit<MountParams, "room">, "container"> | undefined) {
    const enableAppliancePlugin = true
    const manager = await WindowManager.mount({
        // 高比宽
        containerSizeRatio: 9 / 16,
        chessboard: true,
        cursor: !!cursorAdapter,
        supportAppliancePlugin: enableAppliancePlugin,
        ...windowParams,
        container: divRef(),
        room,
    }, {
        TeleBoxManager: WkCustomTeleBoxManager,
        AppManager: WkCustomAppManager
    }
    );
    addManagerListener(manager, logger, handler);
    return manager;
}

class SDKBridge {
    newWhiteSdk = (config: NativeSDKConfig) => {
        const urlInterrupter = config.enableInterrupterAPI ? (url: string) => {
            const modifyUrl: string = sdkCallbackHandler.onUrlInterrupter(url);
            if (modifyUrl.length > 0) {
                return modifyUrl;
            }
            return url;
        } : undefined;

        const slideUrlInterrupter = async (url: string) => {
            if (config.enableSlideInterrupterAPI) {
                const modifyUrl = await sdkCallbackHandler.slideUrlInterrupter(url);
                console.log("slideUrlInterrupter", url, modifyUrl);
                return modifyUrl.length > 0 ? modifyUrl : url;
            }
            return url;
        };

        const { log, __nativeTags, __platform, __netlessUA, initializeOriginsStates, useMultiViews, userCursor, enableInterrupterAPI, routeBackup, enableRtcIntercept, enableRtcAudioEffectIntercept, enableSlideInterrupterAPI, enableImgErrorCallback, enableIFramePlugin, enableSyncedStore, enableAppliancePlugin, ...restConfig } = config;
        const enablePcmDataCallback = (config as any).enablePcmDataCallback || false;

        enableReport(!!log);
        nativeConfig = config;

        if (__platform) {
            window.__platform = __platform;
        }

        if (__netlessUA) {
            window.__netlessUA = __netlessUA.join(' ');
        }

        if (enableImgErrorCallback) {
            hookCreateElement();
        }

        cursorAdapter = !!userCursor ? new CursorTool() : undefined;

        if (__nativeTags) {
            window.__nativeTags = { ...window.__nativeTags, ...__nativeTags };
        }

        const pptParams = restConfig.pptParams || {};
        if (enablePcmDataCallback) {
            window.__pcmProxy = new PCMProxy();
        } else if (enableRtcAudioEffectIntercept) {
            usePlugin(new EffectPlugin(new RtcAudioEffectClient("ppt")));
        } else if (enableRtcIntercept) {
            let rtcAudioMixingClient = new RtcAudioMixingClient();
            pptParams.rtcClient = rtcAudioMixingClient; // 旧版 ppt 使用的 audio mixing 接口。
            usePlugin(new MixingPlugin(rtcAudioMixingClient));
        }
        if (config.loggerOptions && config.loggerOptions.printLevelMask === "debug") {
            usePlugin(new SlideLoggerPlugin());
        }

        const videoJsLogger = (message?: any, ...optionalParams: any[]) => {
            logger("videoJsPlugin", message, ...optionalParams);
        }

        const windowPlugins: { [key in string]: any } = [];
        for (const value of window.pluginParams || []) {
            const p = {
                [value.name]: (window as any)[value.variable]
            };
            windowPlugins.push(p);
        }

        const plugins = createPlugins({
            "video": videoPlugin,
            "audio": audioPlugin,
            "video2": videoPlugin2,
            "audio2": audioPlugin2,
            "video.js": videoJsPlugin({ log: videoJsLogger }),
            ...windowPlugins,
        });
        plugins.setPluginContext("video.js", { enable: false, verbose: true });
        for (const v of window.pluginContext || []) {
            plugins.setPluginContext(v.name, v.params);
        }
        window.plugins = plugins;


        wkWindowManagerStoreBridge = new WKWindowManagerStoreBridge();


        // const slideAppOptions = config.slideAppOptions || {} ;
        // const slideKind = "Slide";
        // WindowManager.register({
        //     kind: slideKind,
        //     appOptions: {
        //         navigatorDelegate: {
        //             openUrl: (url: string) => sdkCallbackHandler.slideOpenUrl(url),
        //         },
        //         urlInterrupter: slideUrlInterrupter,
        //         ...slideAppOptions,
        //     },
        //     addHooks: addHooksSlide,
        //     src: async () => {
        //         return SlideApp;
        //     },
        // });
        // WindowManager.register({
        //     kind: 'Talkative',
        //     src: async () => Talkative,
        //     appOptions: {
        //         debug: false,
        //     },
        // });
        // WindowManager.register({
        //     kind: Plyr.kind,
        //     src:  Plyr,
        // });
        // WindowManager.register({
        //     kind: "AppIframeBridge",
        //     src: AppIframeBridge,
        // });
        // WindowManager.register({
        //     kind: 'Talkative',
        //     src: Talkative,
        //     appOptions: {
        //         debug: false,
        //         onLocalMessage: (_appId: string, event: Record<string, any>) => {
        //             logger('talkativeOnLocalMessage', event)
        //             const { data } = event
        //             if (data && (data as any)?.cwd) {
        //                 call("wuKongOptions.receiveTalkActiveInfo", JSON.stringify(data));
        //             }
        //         },
        //         setReceivePostMessageFun: (fun: (message: unknown) => void) => {
        //             logger('talkativeReceivePostMessageFun', fun)
        //             //@ts-ignore
        //             window.postMessageToTalkActive = fun
        //         },
        //         //获取同步信息
        //         getInfoSync: async (configInfo: string) => {
        //             //@ts-ignore
        //             logger('talkativeGetInfoSyncConfig', configInfo)
        //             const result = await (asyncCall("wuKongOptions.getInfoSync", configInfo) as Promise<string>)
        //             logger('talkativeGetInfoSyncResult', result)
        //             return new Promise((resolve) => {
        //                 resolve(result);
        //             });
        //         }
        //     },
        // })
        // WindowManager.appReadonly = true
        for (const v of window.appRegisterParams || []) {
            WindowManager.register({
                kind: v.kind,
                appOptions: v.appOptions,
                src: v.variable ? window[v.variable] : v.url,
            });
        }

        // 新增的插件需要确定是否依赖此状态
        const useMobXState = enableSyncedStore || enableIFramePlugin || useMultiViews
        const invisiblePlugins = [
            ...enableIFramePlugin ? [IframeBridge as any] : [],
            ...enableSyncedStore ? [SyncedStorePlugin as any] : [],
            ...enableAppliancePlugin ? [ApplianceMultiPlugin as any] : [],
        ];

        const wrappedComponents = [
            ...enableIFramePlugin ? [IframeWrapper] : [],
        ]

        try {
            sdk = new WhiteWebSdk({
                ...restConfig,
                invisiblePlugins: invisiblePlugins,
                wrappedComponents: wrappedComponents,
                plugins: plugins,
                urlInterrupter: urlInterrupter,
                onWhiteSetupFailed: e => {
                    sdkCallbackHandler.onSetupFail(e);
                },
                pptParams,
                useMobXState,
            });
            window.sdk = sdk;
        } catch (e) {
            sdkCallbackHandler.onSetupFail(e);
        }
    };

    joinRoom = (nativeParams: NativeJoinRoomParams & ExtraNativeJoinRoomParams, responseCallback: any) => {
        if (!sdk) {
            responseCallback(JSON.stringify({ __error: { message: "sdk init failed" } }));
            return;
        }
        removeBind();
        const { timeout = 45000, cameraBound, windowParams, disableCameraTransform, nativeWebSocket, appliancePluginOptions, ...joinRoomParams } = nativeParams;

        const { useMultiViews, enableSyncedStore } = nativeConfig!;
        const invisiblePlugins = [
            ...useMultiViews ? [WindowManager as any] : [],
        ]

        window.nativeWebSocket = nativeWebSocket;

        const roomCallbackHandler = new RoomCallbackHandler();

        sdk!.joinRoom({
            useMultiViews,
            disableCameraTransform,
            ...joinRoomParams,
            invisiblePlugins: invisiblePlugins,
            cursorAdapter: useMultiViews ? undefined : cursorAdapter,
            cameraBound: convertBound(cameraBound),
            disableMagixEventDispatchLimit: useMultiViews,
        }, { ...roomCallbackHandler, ...sdkCallbackHandler }).then(async aRoom => {
            removeBind();
            room = aRoom;
            let roomState = room.state;

            /** native 端，把 sdk 初始化时的 useMultiViews 记录下来，再初始化 sdk 的时候，同步传递进来，避免用户写两遍 */
            if (useMultiViews) {
                try {
                    const fullscreen = windowParams && (windowParams as any).fullscreen;
                    window.fullScreen = fullscreen;
                    if (fullscreen) {
                        // css should be inject before mount
                        document.body.appendChild(document.createElement("style")).textContent = `
                            .telebox-titlebar, .telebox-max-titlebar-maximized,.netless-app-slide-footer, .telebox-footer-wrap, .telebox-titlebar-wrap { display: none }
                        `;
                    }

                    const manager = await mountWindowManager(room, roomCallbackHandler, windowParams);
                    roomState = { ...roomState, ...{ windowBoxState: manager.boxState }, cameraState: manager.cameraState, sceneState: manager.sceneState, ...{ pageState: manager.pageState, appState: createAppState() } };

                    if (fullscreen) {
                        manager.setMaximized(true);
                    }
                    const enableAppliancePlugin = true
                    if (enableAppliancePlugin) {
                        const fullWorkerBlob = new Blob([fullWorkerString], { type: 'text/javascript' });
                        const fullWorkerUrl = URL.createObjectURL(fullWorkerBlob);
                        const subWorkerBlob = new Blob([subWorkerString], { type: 'text/javascript' });
                        const subWorkerUrl = URL.createObjectURL(subWorkerBlob);
                        const plugin = await ApplianceMultiPlugin.getInstance(manager,
                            {
                                options: {
                                    cdn: {
                                        fullWorkerUrl,
                                        subWorkerUrl,
                                    },
                                    ...appliancePluginOptions,
                                }
                            }
                        );
                        manager.room.syncMode = true;
                        window.appliancePlugin = plugin;
                        if (plugin.injectMethodToObject) {
                            plugin.injectMethodToObject(window, "requestIdleCallback")
                            plugin.injectMethodToObject(window, "cancelIdleCallback")
                        }
                    }
                } catch (error) {
                    return responseCallback(JSON.stringify({ __error: { message: error.message, jsStack: error.stack } }));
                }
            } else {
                room.bindHtmlElement(divRef() as HTMLDivElement);
                if (!!cursorAdapter) {
                    cursorAdapter.setRoom(room);
                }
                roomState = { ...roomState, ...createPageState(roomState.sceneState) };
            }

            if (enableSyncedStore) {
                await initSyncedStore(room)
            }
            registerBridgeRoom(room);
            // joinRoom 的 disableCameraTransform 参数不生效的 workaround。等 web-sdk 修复后，删除这里的代码。
            room.disableCameraTransform = true
            return responseCallback(JSON.stringify({ state: roomState, observerId: room.observerId, isWritable: room.isWritable }));
        }).catch((e: Error) => {
            return responseCallback(JSON.stringify({ __error: { message: e.message, jsStack: e.stack } }));
        });
    }

    replayRoom = (nativeParams: NativeReplayParams, responseCallback: any) => {
        // nativeReplayParams = nativeParams;
        if (!sdk) {
            responseCallback(JSON.stringify({ __error: { message: "sdk init failed" } }));
            return;
        }

        const { step = 500, cameraBound, mediaURL, windowParams, ...replayParams } = nativeParams;
        removeBind();
        const { useMultiViews, enableSyncedStore } = nativeConfig!;

        let replayCallbackHanlder: ReplayerCallbackHandler;

        const phaseChangeHook = (player: Room, phase: PlayerPhase) => {
            if ((phase === PlayerPhase.Pause || phase === PlayerPhase.Playing) && !!nativeConfig?.useMultiViews && player.getInvisiblePlugin(WindowManager.kind) === null && !window.manager) {
                const room: Room = player! as unknown as Room;
                const { windowParams } = nativeParams!;
                // sdk 内部，先触发回调，才更新 invisiblePlugins，所以要带一个延迟，放到回调后执行
                setTimeout(() => {
                    mountWindowManager(room, replayCallbackHanlder, windowParams).catch(e => {
                        console.error("mount error", e);
                    })
                }, 0);
            }
        }
        replayCallbackHanlder = new ReplayerCallbackHandlerImp(step, !!mediaURL, !!(nativeConfig?.enableIFramePlugin), phaseChangeHook);

        const invisiblePlugins = [
            ...useMultiViews ? [WindowManager as any] : [],
        ]

        sdk!.replayRoom({
            ...replayParams,
            cursorAdapter: useMultiViews ? undefined : cursorAdapter,
            cameraBound: convertBound(cameraBound),
            invisiblePlugins: invisiblePlugins,
            useMultiViews
        }, { ...replayCallbackHanlder, ...sdkCallbackHandler }).then(async mPlayer => {
            removeBind();
            player = mPlayer;
            player.disableCameraTransform = true
            // 多窗口需要调用 player 的 getInvisiblePlugin 方法，获取数据，而这些数据需要在 player 成功初始化，首次进入 play || pause 状态，才能获取到，所以回放时，多窗口需要异步
            if (!useMultiViews) {
                mPlayer.bindHtmlElement(divRef() as HTMLDivElement);
                if (!!cursorAdapter) {
                    cursorAdapter?.setPlayer(player);
                }
            }
            if (enableSyncedStore) {
                await initSyncedStore(player)
            }
            if (mediaURL) {
                // FIXME: 多次初始化，会造成一些问题
                const videoDom = document.createElement("video");
                videoDom.setAttribute("x5-video-player-type", "h5-page");
                videoDom.setAttribute("playsInline", "");
                videoDom.setAttribute("style", "display:none;");
                videoDom.setAttribute("class", "video-js");
                document.body.appendChild(videoDom);

                const combinePlayerFactory = new CombinePlayerFactory(player, {
                    url: mediaURL,
                    videoDOM: videoDom,
                });
                const combinePlayer = combinePlayerFactory.create();
                registerPlayerBridge(mPlayer, combinePlayer, lastSchedule, replayCallbackHanlder);
            } else {
                registerPlayerBridge(mPlayer, undefined, lastSchedule, replayCallbackHanlder);
            }

            const { progressTime: scheduleTime, timeDuration, framesCount, beginTimestamp } = mPlayer;
            return responseCallback(JSON.stringify({ timeInfo: { scheduleTime, timeDuration, framesCount, beginTimestamp } }));
        }).catch((e: Error) => {
            return responseCallback(JSON.stringify({ __error: { message: e.message, jsStack: e.stack } }));
        });
    }

    isPlayable = (nativeReplayParams: NativeReplayParams, responseCallback: any) => {
        if (!sdk) {
            responseCallback(false);
            return;
        }

        const { step = 500, cameraBound, ...replayParams } = nativeReplayParams;
        sdk!.isPlayable({
            ...replayParams
        }).then((isPlayable) => {
            responseCallback(isPlayable);
        })
    }

    asyncInsertFontFaces = (fontFaces: any[], responseCallback: any) => {
        for (const f of fontFaces) {
            const fontWeight = f["font-weight"];
            const fontStyle = f["font-style"];
            const unicodeRange = f["unicode-range"];
            const description = JSON.parse(JSON.stringify({ weight: fontWeight, style: fontStyle, unicodeRange }));
            const font = new FontFace(f["font-family"], f.src, description);
            // FIXME: responseCallback 只能调用一次，第二次再调用，就没有效果了
            font.load().then(_fontFaces => {
                logger("asyncInsertFontFaces load font success", f);
                document.fonts.add(font);
                responseCallback({ success: true, fontFace: f });
            }).catch(e => {
                logger("asyncInsertFontFaces load font failed", f);
                responseCallback({ success: false, fontFace: f, error: e });
            })
        }
    }

    updateNativeFontFaceCSS = (fontFaces: any[]) => {
        let sheet = document.getElementById(nativeFontFaceCSS);
        if (!sheet) {
            sheet = document.createElement("style");
            sheet.id = nativeFontFaceCSS;
            document.body.appendChild(sheet);
        }
        const fontCss = fontFaces.map(v => {
            const css = Object.keys(v).reduce((p, c) => {
                const value: string = v[c];
                // 部分字段有空格，需要使用""包裹，但有"会导致 src 字段等出现问题，不能无脑包裹
                if (value.includes(" ")) {
                    return `${p}\n${c}: "${v[c]}";`;
                } else {
                    return `${p}\n${c}: ${v[c]};`;
                }
            }, "");
            return `@font-face {
                ${css}
            }`;
        })
        sheet.innerHTML = fontCss.join("\n");
    }

    updateNativeTextareaFont = (fonts: string[]) => {
        let sheet = document.getElementById(textareaCSSId);
        if (!sheet) {
            sheet = document.createElement("style");
            sheet.id = textareaCSSId;
            document.body.appendChild(sheet);
        }

        let fontNames = fonts.map(f => `"${f}"`).join(",");

        sheet!.innerHTML = `.netless-whiteboard textarea {
            font-family: ${fontNames}; 
        }`;
    }

    nativeLog = (_logs: string[], responseCallback: any) => {
        responseCallback();
    }

    setParameters = (params: any) => {
        if (Boolean(params.effectMixingForMediaPlayer)) {
            window.__mediaPlayerAudioEffectClient = new RtcAudioEffectClient("mediaPlayer");
        }
    }

    registerApp = (para: AppRegisterParams, responseCallback: any) => {
        if (para.javascriptString) {
            let variable = para.variable!;
            let src = Function(`
                    ${para.javascriptString};
                    if (typeof ${variable} == "undefined") {
                        return undefined; 
                    } else {
                        return ${variable};
                    } 
                    `)();
            if (!src) {
                responseCallback(JSON.stringify({ __error: { message: "variable does not exist" } }));
                return;
            } else {
                WindowManager.register({
                    kind: para.kind,
                    src: src,
                    appOptions: para.appOptions
                }).then(() => responseCallback());
            }
        } else if (para.url) {
            WindowManager.register({
                kind: para.kind,
                src: para.url,
                appOptions: para.appOptions
            }).then(() => responseCallback());
        }
    }

    prepareWhiteConnection = (params: PrepareParams, responseCallback: any) => {
        const { appId, region, expire } = params;
        const expireMS = expire || 12 * 3600 * 1000;
        prepare(appId, region as any, expireMS).then(() => {
            responseCallback();
        }).catch((e: Error) => {
            responseCallback(JSON.stringify({ __error: { message: e.message, jsStack: e.stack } }));
        });
    }

}

let wkWindowManagerStoreBridge: WKWindowManagerStoreBridge | undefined = undefined;

/**
 * 白板窗口管理器桥接
 */
class WKWindowManagerStoreBridge {
    /**
     * 白板窗口管理器
     */
    private wkWindowManagerStore: WKWindowManagerStore | undefined = undefined;

    /**
    * 窗口管理器选项函数
    */
    private _wkWindowManagerStoreOptionsFuncs: WKWindowManagerStoreOptionsFuncs = {
        sendTaskEvent: (_key: string, _state: number) => {
        },
        setIsTalkativeOpening: (_val: boolean) => {
        },
        onTalkativeLocalMessage: (_appId: string, event: Record<string, any>) => {
            logger('talkativeOnLocalMessage', event);
            const { data } = event;
            if (data && (data as any)?.cwd) {
                this.sendMessageToNative(NativeWebBridgeMethod.receiveTalkActiveInfo, data);
            }
        },
        getTalkativeInfoSync: async (configInfo: string) => {
            return this.receiveMessageFromNative(NativeWebBridgeMethod.getTalkativeInfoSync, configInfo);
        },
        getCurrentScenePathBackground: (_scenePath?: string) => {
            return { color: '#fff', imageUrl: '' };
        },
        updateWhiteBoardSizeInfo: (_width: number, _height: number, _scale: number) => {
        },
        getFirstSetWhiteBoardSizeInfo: () => {
            return { width: 0, height: 0, scale: 0 };
        },
        mainViewPageInfo: () => {
            return { showIndex: 0, count: 1 };
        },
        mainViewNextPage: () => {
        },
        mainViewPrevPage: () => {
        },
        mainViewAddPage: () => {
        },
        /**
         * 应用关闭
         * @param closedAppId 关闭的appId
         * @param appInfo 应用信息
         */
        onAppClose: (closedAppId: string, appInfo: AppProxy | undefined) => {
            console.info('onAppClose', closedAppId, appInfo);
            if (closedAppId.toLowerCase().includes('talkative')) {
                this.sendMessageToNative(NativeWebBridgeMethod.onTalkativeClose, {
                    appId: closedAppId,
                });
            }
        },
        onAppSetup: (appId: string, appInfo: AppProxy) => {
            console.info('onAppSetup', appId, appInfo);
        },
        onWindowManagerInit: (windowManger: WindowManager) => {
            window.manager = windowManger;
            windowManger.emitter.on("onMainViewMounted", () => {
                this.wkWindowManagerStore?.initial();
                this.sendMessageToNative(NativeWebBridgeMethod.onMainViewMounted, {});
                windowManger.emitter.off('onMainViewMounted', () => { });
            });
        },
        setReceivePostMessageFun: function (_func: (message: unknown) => void): void {
        }
    }


    constructor() {
        UserOptionsUtils.setCheckPermissionCallback((permission?: string[]) => {
            return this.receiveMessageFromNative(NativeWebBridgeMethod.getHavePermission, JSON.stringify(permission)) as Promise<boolean>
        })
        UserOptionsUtils.setGetCurrentUserInfoCallback(() => {
            return this.receiveMessageFromNative(NativeWebBridgeMethod.getCurrentUserInfo, JSON.stringify({})) as Promise<any>
        })
        this.receiveMessageFromNative(NativeWebBridgeMethod.getShowTextContent,
            JSON.stringify(['whiteboard.error.textIsOtherEdited', 'error.courseware.limit.length',
                'error.courseware.img.limit.length', 'loading', 'whiteboard.error.longPencil'])).then((text) => {
                    UserOptionsUtils.setShowTextContent(JSON.parse(text as string))
                })
        UserOptionsUtils.setIsTeacherCallback(() => {
            return this.receiveMessageFromNative(NativeWebBridgeMethod.getIsTeacher, JSON.stringify({})) as Promise<boolean>
        })
        if (this.wkWindowManagerStore) {
            return
        }
        WKWindowManagerStore.registerAll(this._wkWindowManagerStoreOptionsFuncs)
        this.wkWindowManagerStore = new WKWindowManagerStore(() => {
            return window.manager as WindowManager
        }, (isInitialized: boolean) => {
            if (isInitialized) {
                this.registerListenerAll()
            } else {
                this.unregisterListenerAll()
            }
        })
        //设置白板打开课件的筛选条件
        this.wkWindowManagerStore?.setFilterAppsFun((app: AppProxy) => {
            if (app) {
                if (app.kind == 'Slide' || app.kind == 'DocsViewer' || app.kind == 'Plyr') {
                    const info = getScenePathRoleInfo(app.scenePath)
                    if (info) {
                        return {
                            mainId: info.id,
                            name: "",
                            fileType: info.fileExt,
                        }
                    }
                }
            }
            return undefined
        })
    }

    /**
     * 监听焦点缩放比例
     */
    private onBoxChangeListener(data: { maxMaxTopBox?: any, maxNomalTopBox?: any }) {
        console.info('WhiteboardStore ~ onBoxChangeListener ~ data:', data)
    }

    /**
     * 监听缩放比例
     */
    private onScaleChangeListener(appId: string, _ratio: number) {
        console.info('WhiteboardStore ~ onScaleChangeListener ~ appId:', appId)
    }

    /**
     * 监听页面变化
     */
    private onPageChangeListener(_appId: string, _scenePath: string) {
    }

    /**
     * 监听教具状态变化
     * @param memberState 教具状态
     */
    private onMemberStateChangeListener(memberState: any) {
        console.info('WhiteboardStore ~ onMemberStateChangeListener ~ memberState:', memberState)
    }

    /**
     * 监听激光笔激活状态变化
     * @param active 激活状态
     */
    private onLaserPointerActiveChangeListener(active: boolean) {
        console.info('WhiteboardStore ~ onLaserPointerActiveChangeListener ~ active:', active)
    }



    /**
     * 注册所有监听
     */
    public registerListenerAll() {
        this.wkWindowManagerStore?.classListManager?.addBoxChangeListener(this.onBoxChangeListener)
        this.wkWindowManagerStore?.scaleManager?.addScaleChangeListener(this.onScaleChangeListener)
        this.wkWindowManagerStore?.addPageChangeListener(this.onPageChangeListener)
        this.wkWindowManagerStore?.addMemberStateChangeListener(this.onMemberStateChangeListener)
        this.wkWindowManagerStore?.laserPointerManager?.addCallbackActiveListener(this.onLaserPointerActiveChangeListener)
        this.onBoxChangeListener({ maxMaxTopBox: undefined, maxNomalTopBox: undefined })
    }

    /**
     * 移除所有监听
     */
    public unregisterListenerAll() {
        this.wkWindowManagerStore?.classListManager?.removeBoxChangeListener(this.onBoxChangeListener)
        this.wkWindowManagerStore?.scaleManager?.removeScaleChangeListener(this.onScaleChangeListener)
        this.wkWindowManagerStore?.removePageChangeListener(this.onPageChangeListener)
        this.wkWindowManagerStore?.removeMemberStateChangeListener(this.onMemberStateChangeListener)
        this.wkWindowManagerStore?.laserPointerManager?.removeCallbackActiveListener(this.onLaserPointerActiveChangeListener)
    }


    /**
     * 发送消息给原生
     * @param method 方法名
     * @param data 数据
     */
    private sendMessageToNative(method: NativeWebBridgeMethod, data?: any) {
        logger('sendMessageToNative', method, data)
        call(`wuKongOptions.sendMessageToNative`, JSON.stringify({method, data}));
    }
    /**
     * 接收消息来自原生
     * @param data 数据
     */
    private receiveMessageFromNative = async (method: NativeWebBridgeMethod, data: string) => {
        logger('receiveMessageFromNative', method, data)
        const result = await (asyncCall(`wuKongOptions.getInfoSync`, JSON.stringify({ method, data })) as Promise<string>)
        logger('receiveMessageFromNativeResult', result)
        return new Promise((resolve) => {
            resolve(result);
        });
    }
}
/**
 * 原生 web 桥接方法
 */
enum NativeWebBridgeMethod {

    /**
     * 接收 talkative 消息发送给原生
     * 参数：data
     * 
     */
    receiveTalkActiveInfo = 'receiveTalkActiveInfo',

    /**
     * 获取talkative同步信息
     * 参数：configInfo
     * 
     */
    getTalkativeInfoSync = 'getTalkativeInfoSync',

    /**
     * 监听到互动题关闭事件发送到原生
     * 参数：{
          appId: closedAppId,
          appInfo: appInfo,
        }
     */
    onTalkativeClose = 'onTalkativeClose',

    /**
     * 监听到主视图挂载事件发送到原生
     * 参数：{}
     */
    onMainViewMounted = 'onMainViewMounted',

    /**
     * 获取是否有权限
     * 参数：permission
     * 返回：boolean
     */
    getHavePermission = 'getHavePermission',

    /**
     * 获取当前用户信息
     * 返回：{
     * userId: string,
     * userName: string,
     * userRole: string,
     * }
     */
    getCurrentUserInfo = 'getCurrentUserInfo',
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
}