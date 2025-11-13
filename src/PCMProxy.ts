import { call } from "./bridge";
import { logger } from "./utils/Logger";

export class PCMProxy {
  private audioContext: AudioContext;
  private scriptProcessor: ScriptProcessorNode;
  private gainNode: GainNode;

  private _updatingPcmData = false;
  private resumeTimer: number | null = null;

  convertToInt16Array(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const pcm = Math.max(-1, Math.min(1, float32Array[i])) * 32767;
      int16Array[i] = pcm;
    }
    return int16Array;
  }

  constructor() {
    const compatibleAudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!compatibleAudioContext) {
      throw new Error("AudioContext is not supported");
    }
    const sampleRate = 48000;
    const bufferSize = 4096;
    const channelCount = 1;
    const audioContext = new compatibleAudioContext({ sampleRate: sampleRate });
    const scriptProcessor = audioContext.createScriptProcessor(
      bufferSize,
      channelCount,
      channelCount
    );
    const gainNode = audioContext.createGain();

    scriptProcessor.onaudioprocess = (event) => {
      const inputBuffer = event.inputBuffer;
      const inputArray = inputBuffer.getChannelData(0);
      const isAllZero = inputArray.every((value) => value === 0);
      if (isAllZero) {
        if (this._updatingPcmData) {
          this._updatingPcmData = false;
          console.log("[pcm] stream become empty");
        }
        return;
      }
      const int16Array = this.convertToInt16Array(inputArray);
      const array = Array.from(int16Array);
      call("pcm.pcmDataUpdate", array);
      if (!this._updatingPcmData) {
        this._updatingPcmData = true;
        console.log("[pcm] stream become valid");
      }
    };

    gainNode.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
    this.audioContext = audioContext;
    this.scriptProcessor = scriptProcessor;
    this.gainNode = gainNode;
    logger(
      `[pcm] proxy init sampleRate: ${sampleRate}, bufferSize: ${bufferSize}, channelCount: ${channelCount}, state: ${audioContext.state}`
    );

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (this.resumeTimer) {
          return;
        }
        console.log(
          "[pcm] visibility -> visible, resume audioContext and create resume timer"
        );
        this.audioContext.resume();
        // create a looping timer.
        this.resumeTimer = window.setInterval(() => {
          if (this.audioContext.state === "suspended") {
            console.log(
              "[pcm] resume timer: audioContext.state is suspended, resuming"
            );
            this.audioContext.resume();
          }
        }, 3000);
      } else {
        if (this.resumeTimer) {
          window.clearInterval(this.resumeTimer);
          this.resumeTimer = null;
        }
      }
    });
  }

  connect(mediaElement: HTMLMediaElement): MediaElementAudioSourceNode {
    const source = this.audioContext.createMediaElementSource(mediaElement);
    source.connect(this.gainNode);

    // 根据audio元素的muted状态和volume大小控制gainNode
    const updateGain = () => {
      if (mediaElement.muted) {
        this.gainNode.gain.value = 0;
        console.log(`[pcm] media element muted, setting gain to 0`);
      } else {
        // 使用audio元素的volume值（范围0-1）
        this.gainNode.gain.value = mediaElement.volume;
        console.log(
          `[pcm] media element volume changed, setting gain to ${mediaElement.volume}`
        );
      }
    };

    // 初始化时设置gain
    updateGain();

    // 监听volumechange事件（包括muted状态和volume大小变化）
    mediaElement.addEventListener("volumechange", updateGain);

    console.log(
      `[pcm] connect media element tag: ${mediaElement.tagName}, src: ${mediaElement.src}, muted: ${mediaElement.muted}, volume: ${mediaElement.volume}, connectedSource: ${source}`
    );
    return source;
  }
}
