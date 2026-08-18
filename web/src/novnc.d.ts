// @novnc/novnc ships no TypeScript types; declare the small surface we use.
declare module '@novnc/novnc/lib/rfb' {
  export interface RFBOptions {
    shared?: boolean;
    credentials?: { username?: string; password?: string; target?: string };
    repeaterID?: string;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(target: Element, urlOrChannel: string | WebSocket, options?: RFBOptions);

    viewOnly: boolean;
    scaleViewport: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    showDotCursor: boolean;

    disconnect(): void;
    focus(): void;
    blur(): void;
    sendCredentials(credentials: { username?: string; password?: string; target?: string }): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    sendCtrlAltDel(): void;
    machineShutdown(): void;
    machineReboot(): void;
    machineReset(): void;
    clipboardPasteFrom(text: string): void;
  }
}
