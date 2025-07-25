import { AppResult, Attributes as SlideAttributes } from "@netless/app-slide";
import { TeleBoxColorScheme } from '@netless/telebox-insider';
import { AddAppOptions, AddPageParams, BuiltinApps, WindowManager } from "@netless/window-manager";
import { GlobalState, ImageInformation, MemberState, Room, SceneDefinition, ViewMode, ApplianceNames } from "white-web-sdk";
import { addBridgeLogHook, createPageState } from "../utils/Funs";
import { logger } from "../utils/Logger";
import { registerDisplayerBridge } from "./Displayer";
import { call, register, registerAsyn } from ".";
import { pptNamespace, RemovePageParams, roomNamespace, roomStateNamespace, roomSyncNamespace } from "@netless/whiteboard-bridge-types";

export function registerBridgeRoom(aRoom: Room) {
    window.room = aRoom;
    registerDisplayerBridge(aRoom);

    // FIXME:同步方法尽量还是放在同步方法里。
    // 由于 Android 不方便改，暂时只把新加的 get 方法放在此处。dsbridge 注册时，同一个注册内容，会被覆盖，而不是合并。
    register(roomNamespace, new RoomBridge());
    registerAsyn(roomNamespace, new RoomAsyncBridge(aRoom));
    register(pptNamespace, new RoomPPTBridge(aRoom));
    register(roomSyncNamespace, new RoomSyncBridge(aRoom));
    register(roomStateNamespace, new RoomStateBridge(aRoom));

    addBridgeLogHook([roomNamespace, pptNamespace, roomSyncNamespace, roomStateNamespace], logger);
}

type VideoPluginInfo = {
    readonly props?: {
        videoUrl: string;
    }
    readonly centerX: number;
    readonly centerY: number;
    readonly width: number;
    readonly height: number;
};

type EventEntry = {
    eventName: string;
    payload: any;
};

type DocsEventOptions = {
    /** If provided, will dispatch to the specific app. Default to the focused app. */
    appId?: string;
    /** Used by `jumpToPage` event, range from 1 to total pages count. */
    page?: number;
}

function makeSlideParams(scenes: SceneDefinition[]): {
    scenesWithoutPPT: SceneDefinition[];
    taskId: string;
    url: string;
} {
    const scenesWithoutPPT: SceneDefinition[] = scenes.map(v => { return { name: v.name } });
    let taskId = "";
    let url = "";

    // e.g. "ppt(x)://prefix/dynamicConvert/{taskId}/1.slide"
    const pptSrcRE = /^pptx?(?<prefix>:\/\/\S+?dynamicConvert)\/(?<taskId>\w+)\//;
    for (const { ppt } of scenes) {
        if (!ppt || !ppt.src.startsWith("ppt")) {
            continue;
        }
        const match = pptSrcRE.exec(ppt.src);
        if (!match || !match.groups) {
            continue;
        }
        taskId = match.groups.taskId;
        url = "https" + match.groups.prefix;
        break;
    }

    return { scenesWithoutPPT, taskId, url };
}

function addSlideApp(scenePath: string, title: string, scenes: SceneDefinition[]): Promise<string | undefined> {
    const { scenesWithoutPPT, taskId, url } = makeSlideParams(scenes);
    try {
        if (taskId && url) {
            return window.manager!.addApp({
                // TODO: extract to a constant
                kind: "Slide",
                options: {
                    scenePath,
                    title,
                    scenes: scenesWithoutPPT,
                },
                attributes: {
                    taskId,
                    url,
                } as SlideAttributes,
            }).then((id)=> {
                if (window.fullScreen || false) {
                    window.manager!.setMaximized(true);
                }
                return id;
            })
        } else {
            return window.manager!.addApp({
                kind: BuiltinApps.DocsViewer,
                options: {
                    scenePath,
                    title,
                    scenes,
                },
            }).then((id)=> {
                if (window.fullScreen || false) {
                    window.manager!.setMaximized(true);
                }
                return id;
            });
        }
    } catch (err) {
        logger("addSlideApp error", err);
        return Promise.reject()
    }
}

function updateIframePluginState(room: Room) {
    // iframe 根据 disableDeviceInputs 禁用操作，主动修改该值后，需要调用 updateIframePluginState 来更新状态
    // tslint:disable-next-line:no-unused-expression
    room.getInvisiblePlugin("IframeBridge") && (room.getInvisiblePlugin("IframeBridge")! as any).computedZindex();
    // tslint:disable-next-line:no-unused-expression
    room.getInvisiblePlugin("IframeBridge") && (room.getInvisiblePlugin("IframeBridge")! as any).updateStyle();
}

// 避免命名冲突，添加 Outer 后缀
function dispatchDocsEventOuter(
    manager: WindowManager,
    event: "prevPage" | "nextPage" | "prevStep" | "nextStep" | "jumpToPage",
    options: DocsEventOptions = {}
): boolean {
    const appId = options.appId || manager.focused;
    if (!appId) {
        console.warn("not found " + (options.appId || "focused app"));
        return false;
    }

    let page: number | undefined, input: HTMLInputElement | null;

    // Click the DOM elements for static docs
    if (appId.startsWith("DocsViewer-")) {
        const dom = manager.queryOne(appId)?.box?.$footer;
        if (!dom) {
            console.warn("not found app with id " + appId);
            return false;
        }

        const click = (el: Element | null) => {
            el && el.dispatchEvent(new MouseEvent("click"));
        };

        switch (event) {
            case "prevPage":
            case "prevStep":
                click(dom.querySelector('button[class$="btn-page-back"]'));
                break;
            case "nextPage":
            case "nextStep":
                click(dom.querySelector('button[class$="btn-page-next"]'));
                break;
            case "jumpToPage":
                page = options.page;
                input = dom.querySelector('input[class$="page-number-input"]');
                if (!input || typeof page !== "number") {
                    console.warn("failed to jump" + (page ? " to page " + page : ""));
                    return false;
                }
                input.value = "" + page;
                input.dispatchEvent(new InputEvent("change"));
                break;
            default:
                console.warn("unknown event " + event);
                return false;
        }

        return true;
    }

    // Check controller for slide docs
    else if (appId.startsWith("Slide-")) {
        const app = manager.queryOne(appId)?.appResult as AppResult | undefined;
        if (!app) {
            console.warn("not found app with id " + appId);
            return false;
        }

        switch (event) {
            case "prevPage":
                return app.prevPage();
            case "nextPage":
                return app.nextPage();
            case "prevStep":
                return app.prevStep();
            case "nextStep":
                return app.nextStep();
            case "jumpToPage":
                page = options.page;
                if (typeof page !== "number") {
                    console.warn("failed to jump" + (page ? " to page " + page : ""));
                    return false;
                }
                return app.jumpToPage(page);
            default:
                console.warn("unknown event " + event);
                return false;
        }
    }

    // No support for any other kind
    else {
        console.warn("not supported app " + appId);
        return false;
    }
}

export class RoomBridge {
    setWindowManagerAttributes = (attributes: any) => {
        window.manager?.safeSetAttributes(attributes);
        window.manager?.refresh();
    }

    setContainerSizeRatio = (ratio) => {
        window.manager?.setContainerSizeRatio(ratio);
    }

    setPrefersColorScheme = (scheme: TeleBoxColorScheme) => {
        window.manager?.setPrefersColorScheme(scheme);
    }
}

export class RoomPPTBridge {
    constructor(readonly room: Room) { }
    nextStep = () => {
        this.room.pptNextStep();
    }

    previousStep = () => {
        this.room.pptPreviousStep();
    }
}

export class RoomSyncBridge {
    constructor(readonly room: Room) { }
    syncBlockTimestamp = (timestamp: number) => {
        this.room.syncBlockTimestamp(timestamp);
    }

    /** 默认为 true，房间内，任一用户设置为 false，会使 web 2.9.2 和 native 2.9.3 出现报错而不能正常使用。*/
    disableSerialization = (disable: boolean) => {
        this.room.disableSerialization = disable;
        /** 单窗口且开启序列化主动触发一次redo,undo次数回调 */
        if (!disable && window.manager == null) {
            call("room.fireCanUndoStepsUpdate", this.room.canUndoSteps);
            call("room.fireCanRedoStepsUpdate", this.room.canRedoSteps);
        }
    }

    copy = () => {
        this.room.copy();
    }

    paste = () => {
        this.room.paste();
    }

    duplicate = () => {
        this.room.duplicate();
    }

    delete = () => {
        this.room.delete();
    }

    disableEraseImage = (disable) => {
        this.room.disableEraseImage = disable;
    }
}

export class RoomAsyncBridge {
    constructor(readonly room: Room) { }
    redo = (responseCallback: any) => {
        const count = this.room.redo();
        responseCallback(count);
    }

    /** 撤回 */
    undo = (responseCallback: any) => {
        const count = this.room.undo();
        responseCallback(count);
    }

    /** 取消撤回 */
    canRedoSteps = (responseCallback: any) => {
        if (window.manager) {
            responseCallback(window.manager.canRedoSteps);
        } else {
            responseCallback(this.room.canRedoSteps);
        }
    }

    canUndoSteps = (responseCallback: any) => {
        if (window.manager) {
            responseCallback(window.manager.canUndoSteps);
        } else {
            responseCallback(this.room.canUndoSteps);
        }
    }

    /** set 系列API */
    setGlobalState = (modifyState: Partial<GlobalState>) => {
        this.room.setGlobalState(modifyState);
    }

    /** 替代切换页面，设置当前场景。path 为想要设置场景的 path */
    setScenePath = (scenePath: string, responseCallback: any) => {
        try {
            if (window.manager) {
                window.manager.setMainViewScenePath(scenePath);
            } else {
                this.room.setScenePath(scenePath);
            }
            responseCallback(JSON.stringify({}));
        } catch (e) {
            return responseCallback(JSON.stringify({ __error: { message: e.message, jsStack: e.stack } }));
        }
    }

    addPage = (params: AddPageParams, responseCallback?: any) => {
        if (window.manager) {
            window.manager.addPage(params)
            .then(() => {
                if (responseCallback) {
                    responseCallback();
                }
            }).catch(e => {
                if (responseCallback) {
                    return responseCallback(JSON.stringify({ __error: { message: e.message, jsStack: e.stack } }));
                }
            });
        } else {
            const dir = this.room.state.sceneState.contextPath;
            const after = params.after;
            if (after) {
                const tIndex = this.room.state.sceneState.index + 1;
                this.room.putScenes(dir, [params.scene || {}], tIndex);
            } else {
                this.room.putScenes(dir, [params.scene || {}]);
            }
            if (responseCallback) {
                setTimeout(() => {
                    responseCallback();
                }, 0);
            }
        }
    }

    removePage = (params: RemovePageParams, responseCallback: any) => {
        if (window.manager) {
            window.manager.removePage(params.index)
            .then(success => {
                responseCallback(success);
            })
            .catch(e => {
                return responseCallback(JSON.stringify({ __error: { message: e.message, jsStack: e.stack } }));
            })
        } else {
            const scenes = this.room.state.sceneState.scenes;
            const index = params.index || this.room.state.sceneState.index;
            if (scenes.length == 1) {
                logger("removePage warning", "can't remove the last page");
                return responseCallback(JSON.stringify({ __error: { message: "removePage warning, can't remove the last page"} }));
            }
            if (index < scenes.length) {
                const dir = this.room.state.sceneState.contextPath
                // 根场景时 contextPath 为 "/", 其他场景示例 "/context/Path"
                const dirWithSlash = dir.endsWith("/") ? dir : dir + "/";
                this.room.removeScenes(dirWithSlash + scenes[index].name);
                return responseCallback(true);
            } else {
                logger("removePage warning", "index out of range");
                return responseCallback(JSON.stringify({ __error: { message: 'removePage warning, index out of range'} }));
            }
        }
    }

    nextPage = (responseCallback: any) => {
        if (window.manager) {
            window.manager.nextPage().then((result) => {
                responseCallback(result)
            })
        } else {
            const nextIndex = this.room.state.sceneState.index + 1;
            if (nextIndex < this.room.state.sceneState.scenes.length) {
                this.room.setSceneIndex(nextIndex)
                responseCallback(true)
            } else {
                responseCallback(false)
            }
        }
    }

    prevPage = (responseCallback: any) => {
        if (window.manager) {
            window.manager.prevPage().then((result) => {
                responseCallback(result)
            })
        } else {
            const prevIndex = this.room.state.sceneState.index - 1;
            if (prevIndex >= 0) {
                this.room.setSceneIndex(prevIndex)
                responseCallback(true)
            } else {
                responseCallback(false)
            }
        }
    }

    setMemberState = (memberState: Partial<MemberState>) => {
        const state = {...memberState}
        if (state.currentApplianceName == ApplianceNames.hand) {
            state.currentApplianceName = ApplianceNames.clicker
        }

        if (state.currentApplianceName == ApplianceNames.pencilEraser) {
            window.appliancePlugin?.setMemberState?.({eraserColor: [255, 255, 255], eraserOpacity: 1})
            // @ts-ignore
            // this.room.setMemberState({eraserColor: [255, 255, 255], eraserOpacity: 1})
        }
        this.room.setMemberState(state);
    }

    setViewMode = (viewMode: string) => {
        let mode = ViewMode[viewMode] as any;
        if (mode === undefined) {
            mode = ViewMode.Freedom;
        }
        if (window.manager) {
            window.manager.setViewMode(mode);
        } else {
            this.room.setViewMode(mode);
        }
    }

    setWritable = (writable: boolean, responseCallback: any) => {
        this.room.setWritable(writable).then(() => {
            responseCallback(JSON.stringify({ isWritable: this.room.isWritable, observerId: this.room.observerId }));
        }).catch(error => {
            responseCallback(JSON.stringify({ __error: { message: error.message, jsStack: error.stack } }));
        });
    }

    /** get 系列 API */
    getMemberState = (responseCallback: any) => {
        return responseCallback(JSON.stringify(this.room.state.memberState));
    }

    getGlobalState = (responseCallback: any) => {
        return responseCallback(JSON.stringify(this.room.state.globalState));
    }

    getSceneState = (responseCallback: any) => {
        return responseCallback(JSON.stringify(this.room.state.sceneState));
    }

    getRoomMembers = (responseCallback: any) => {
        return responseCallback(JSON.stringify(this.room.state.roomMembers));
    }

    /** @deprecated 使用 scenes 代替，ppt 将作为 scene 的成员变量 */
    getPptImages = (responseCallback: any) => {
        const ppts = this.room.state.sceneState.scenes.map(s => {
            if (s.ppt) {
                return s.ppt.src;
            } else {
                return "";
            }
        });
        return responseCallback(JSON.stringify(ppts));
    }

    setSceneIndex = (index: number, responseCallback: any) => {
        try {
            if (window.manager) {
                window.manager.setMainViewSceneIndex(index);
            } else {
                this.room.setSceneIndex(index);
            }
            responseCallback(JSON.stringify({}));
        } catch (error) {
            responseCallback(JSON.stringify({ __error: { message: error.message, jsStack: error.stack } }));
        }
    }

    getScenes = (responseCallback: any) => {
        return responseCallback(JSON.stringify(this.room.state.sceneState.scenes));
    }

    getZoomScale = (responseCallback: any) => {
        let scale = 1;
        if (window.manager) {
            scale = window.manager.mainView.camera.scale;
        } else {
            scale = this.room.state.cameraState.scale;
        }
        return responseCallback(JSON.stringify(scale));
    }

    getBroadcastState = (responseCallback: any) => {
        return responseCallback(JSON.stringify(this.room.state.broadcastState));
    }

    getRoomPhase = (responseCallback: any) => {
        return responseCallback(this.room.phase);
    }

    disconnect = (responseCallback: any) => {
        this.room.disconnect().then(() => {
            responseCallback();
        });
    }

    zoomChange = (scale: number) => {
        this.room.moveCamera({ scale });
    }

    disableCameraTransform = (disableCamera: boolean) => {
        this.room.disableCameraTransform = disableCamera;
    }

    disableDeviceInputs = (disable: boolean) => {
        if (window.manager) {
            window.manager.setReadonly(disable);
        }
        if (window.appliancePlugin) {
            window.appliancePlugin.disableDeviceInputs = disable
        }
        this.room.disableDeviceInputs = disable;
        updateIframePluginState(this.room);
    }

    // not used now
    disableOperations = (disableOperations: boolean) => {
        this.room.disableCameraTransform = disableOperations;
        if (window.manager) {
            window.manager.setReadonly(disableOperations);
        }
        if (window.appliancePlugin) {
            window.appliancePlugin.disableDeviceInputs = disableOperations
        }
        this.room.disableDeviceInputs = disableOperations;
        updateIframePluginState(this.room);
    }

    disableWindowOperation = (disable: boolean) => {
        window.manager?.setReadonly(disable);
    }

    putScenes = (dir: string, scenes: SceneDefinition[], index: number, responseCallback: any) => {
        this.room.putScenes(dir, scenes, index);
        responseCallback(JSON.stringify(this.room.state.sceneState));
    }

    removeScenes = (dirOrPath: string) => {
        this.room.removeScenes(dirOrPath);
    }

    /* 移动，重命名当前scene，参考 mv 命令 */
    moveScene = (source: string, target: string) => {
        this.room.moveScene(source, target);
    }

    /**
     * 在指定位置插入文字
     * @param x 第一个字的的左侧边中点，世界坐标系中的 x 坐标
     * @param y 第一个字的的左侧边中点，世界坐标系中的 y 坐标
     * @param textContent 初始化文字的内容
     * @param responseCallback 完成回调
     * @returns 该文字的标识符
     */
    insertText = (x: number, y: number, textContent: string, responseCallback: any) => {
        if (window.manager) {
            responseCallback(window.manager.focusedView?.insertText(x, y, textContent));
        } else {
            responseCallback(this.room.insertText(x, y, textContent));
        }
    }

    /**
     * 编辑指定文字的内容
     * @param identifier 文字的标识符。为 ``insertText()`` 的返回值。
     * @param textContent 文字要改成的内容
     */
    updateText = (identifier: string, textContent: string) => {
        if (window.manager) {
            window.manager.focusedView?.updateText(identifier, textContent);
        } else {
            this.room.updateText(identifier, textContent);
        }
    }

    cleanScene = (retainPpt: boolean) => {
        let retain: boolean;
        if (retainPpt === undefined) {
            retain = false;
        } else {
            retain = !!retainPpt;
        }
        this.room.cleanCurrentScene(retainPpt);
    }

    insertImage = (imageInfo: ImageInformation) => {
        this.room.insertImage(imageInfo);
    }

    insertVideo = (videoInfo: VideoPluginInfo) => {
        // TODO: ???
    }

    completeImageUpload = (uuid: string, url: string) => {
        this.room.completeImageUpload(uuid, url);
    }

    dispatchMagixEvent = (event: EventEntry) => {
        this.room.dispatchMagixEvent(event.eventName, event.payload);
    }

    setTimeDelay = (delay: number) => {
        this.room.timeDelay = delay;
    }

    addApp = (kind: string, options: any, attributes: any, responseCallback: any) => {
        if (window.manager) {
            if (kind === "Slide") {
                // 检查是否使用由 projector 转换服务
                const { taskId, url } = attributes || {}
                if (taskId && url) {
                    window.manager.addApp({
                        kind: kind,
                        options: options as AddAppOptions,
                        attributes: attributes as SlideAttributes
                    }).then(appId => {
                        responseCallback(appId)
                    });
                } else {
                    // 兼容Canvas版本转换服务
                    const opts = options as AddAppOptions
                    addSlideApp(opts.scenePath!, opts.title!, opts.scenes!)
                        .then(appId => {
                            responseCallback(appId)
                        })
                }
            } else {
                window.manager.addApp({
                    kind: kind,
                    options: options,
                    attributes: attributes
                }).then(appId => {
                    responseCallback(appId)
                });
            }
            if (window.fullScreen || false) {
                window.manager.setMaximized(true);
            }
        }
    }

    closeApp = (appId: string, responseCallback: any) => {
        if (window.manager) {
            window.manager.closeApp(appId).then(() => {
                return responseCallback(undefined);
            });
        }
    }

    focusApp = (appId: string) => {
        if (window.manager) {
            window.manager.focusApp(appId);
        }
    }

    queryAllApps = (responseCallback: any) => {
        if (window.manager) {
            const apps = window.manager.apps;
            if (apps) {
                return responseCallback(JSON.stringify(window.manager.apps))
            } else {
                return responseCallback({});
            }
        }
    }

    queryApp = (appId: string, responseCallback: any) => {
        if (window.manager) {
            const apps = window.manager.apps;
            if (!apps) {
                return responseCallback(JSON.stringify({ __error: { message: "apps not existed" } }));
            }
            const app = apps[appId];
            if (app) {
                return responseCallback(JSON.stringify(app));
            } else {
                return responseCallback(JSON.stringify({ __error: { message: "app " + appId + " not existed" } }));
            }
        }
    }

    dispatchDocsEvent = (
        event: "prevPage" | "nextPage" | "prevStep" | "nextStep" | "jumpToPage",
        options: DocsEventOptions = {},
        responseCallback: any
    ) => {
        if (window.manager) {
            responseCallback(dispatchDocsEventOuter(window.manager, event, options || {}));
        };
    }

    syncMode = (useSyncMode: boolean) => {
        this.room.syncMode = useSyncMode;
    }
}

export class RoomStateBridge {
    constructor(readonly room: Room) { }
    getRoomState = () => {
        const state = this.room.state;
        if (window.manager) {
            return { ...state, ...{ windowBoxState: window.manager.boxState }, cameraState: window.manager.cameraState, sceneState: window.manager.sceneState, ...{ pageState: window.manager.pageState } };
        } else {
            return { ...state, ...createPageState(state.sceneState) };
        }
    }

    getTimeDelay = () => {
        return this.room.timeDelay;
    }

    getPhase = () => {
        return this.room.phase;
    }

    isWritable = () => {
        return this.room.isWritable;
    }

    debugInfo = () => {
        try {
            const screen = (this.room as any).screen;
            const { camera, visionRectangle, adaptedRectangle, divElement } = screen;
            return { camera, visionRectangle, adaptedRectangle, divWidth: divElement.clientWidth, divHeight: divElement.clientHeight };
        } catch (error) {
            return { error: error.message };
        }
    }
}