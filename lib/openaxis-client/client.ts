/**
 * OpenAxis v0.2 WebSocket Client
 *
 * All messages use msgpack binary framing. No leases — the most recently
 * connected client is the active one.
 */

import { encode, decode } from "@msgpack/msgpack";
import {
  CameraPoseMessage,
  ConnectionState,
  FrameMessage,
  Handedness,
  NavigationMode,
  NavigationPreferencesMessage,
  ObjectPoseMessage,
  OpenAxisClientEvents,
  OpenAxisClientOptions,
  PoseMode,
  PROTO_VERSION,
  TranslationScaleMode,
} from "./types";

const DEFAULT_URL = "ws://127.0.0.1:6607";
const HEARTBEAT_INTERVAL_MS = 1000;

export class OpenAxisClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = ConnectionState.Disconnected;
  private options: OpenAxisClientOptions & { url: string };
  private events: OpenAxisClientEvents;
  private goodUrl: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    options: OpenAxisClientOptions,
    events: OpenAxisClientEvents = {},
  ) {
    this.options = {
      url: DEFAULT_URL,
      ...options,
    };
    this.events = events;
  }

  getState(): ConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state !== ConnectionState.Disconnected) {
      throw new Error(`Cannot connect from state: ${this.state}`);
    }

    // try each candidate URL in order, starting from the last one that
    // worked; the state stays Connecting across attempts
    const urls = this.options.urls?.length ? this.options.urls : [this.options.url];
    const start = Math.max(0, urls.indexOf(this.goodUrl ?? ""));
    let lastError: unknown = new Error("WebSocket error");
    for (let i = 0; i < urls.length; i++) {
      const url = urls[(start + i) % urls.length];
      try {
        await this.tryConnect(url);
        this.goodUrl = url;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    this.setState(ConnectionState.Disconnected);
    throw lastError;
  }

  private tryConnect(url: string): Promise<void> {
    this.setState(ConnectionState.Connecting);

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          // Send hello (msgpack)
          this.send({
            type: "hello",
            proto: PROTO_VERSION,
            client_name: this.options.clientName,
          });

          // Auto-send setup messages before flipping state: onStateChange
          // fires synchronously, and anything a handler sends (e.g. fresh
          // tags) must not be overwritten by these stored values
          if (this.options.tags?.length) this.sendTags(this.options.tags);
          if (this.options.capabilities?.length) this.sendCapabilities(this.options.capabilities);
          if (this.options.axes?.length) this.subscribe(this.options.axes);

          this.setState(ConnectionState.Connected);
          this.startHeartbeat();

          resolve();
        };

        ws.onerror = () => {
          // detach so the doomed socket's close event can't clobber a
          // later attempt's state
          ws.onerror = null;
          ws.onclose = null;
          if (this.ws === ws) this.ws = null;
          reject(new Error("WebSocket error"));
        };

        ws.onclose = () => {
          this.handleDisconnect();
        };

        ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.state === ConnectionState.Disconnected) {
      return;
    }
    this.setState(ConnectionState.Disconnecting);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.handleDisconnect();
  }

  // -- v0.2 send methods --

  sendTags(tags: string[]): void {
    // keep the stored tags current so a reconnect resumes with the latest
    // set rather than the constructor-time snapshot
    this.options.tags = tags;
    this.send({ type: "tags", tags });
  }

  sendCapabilities(capabilities: string[]): void {
    this.send({ type: "capabilities", capabilities });
  }

  subscribe(axes: string[]): void {
    this.send({ type: "subscribe", axes });
  }

  sendWorldOrientation(
    forward: [number, number, number],
    up: [number, number, number],
    handedness: Handedness = "right",
  ): void {
    this.send({ type: "world_orientation", forward, up, handedness });
  }

  sendTranslationScale(
    mode: TranslationScaleMode = "viewport",
    translationScale: number = 1.0,
  ): void {
    this.send({ type: "translation_scale", mode, translation_scale: translationScale });
  }

  sendNavigationPreferences(
    prefs: {
      recenterOnPan?: boolean;
      lockPitch?: boolean;
      lockYaw?: boolean;
      lockRoll?: boolean;
      lockTranslationPlane?: boolean;
    } = {},
  ): void {
    const msg: NavigationPreferencesMessage = { type: "navigation_preferences" };
    if (prefs.recenterOnPan !== undefined) msg.recenter_on_pan = prefs.recenterOnPan;
    if (prefs.lockPitch !== undefined) msg.lock_pitch = prefs.lockPitch;
    if (prefs.lockYaw !== undefined) msg.lock_yaw = prefs.lockYaw;
    if (prefs.lockRoll !== undefined) msg.lock_roll = prefs.lockRoll;
    if (prefs.lockTranslationPlane !== undefined)
      msg.lock_translation_plane = prefs.lockTranslationPlane;
    this.send(msg);
  }

  sendCameraPose(
    t: [number, number, number],
    r: [number, number, number],
    mode: PoseMode = "absolute",
    fov?: number,
    orthoExtent?: number,
  ): void {
    const msg: Record<string, unknown> = { type: "camera.pose", t, r, mode };
    if (fov !== undefined) msg.fov = fov;
    if (orthoExtent !== undefined) msg.ortho_extent = orthoExtent;
    this.send(msg);
  }

  sendCameraPivot(point: [number, number, number]): void {
    this.send({ type: "camera.pivot", point });
  }

  sendObjectPose(
    t: [number, number, number],
    r: [number, number, number],
    mode: PoseMode = "absolute",
  ): void {
    this.send({ type: "object.pose", t, r, mode });
  }

  sendObjectPivot(point: [number, number, number]): void {
    this.send({ type: "object.pivot", point });
  }

  // -- Internals --

  private send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }
    this.ws.send(encode(message));
  }

  private handleMessage(data: unknown): void {
    if (!(data instanceof ArrayBuffer)) return;

    let msg: Record<string, unknown>;
    try {
      msg = decode(new Uint8Array(data)) as Record<string, unknown>;
    } catch {
      console.error("Failed to decode msgpack message");
      return;
    }

    this.dispatch(msg);
  }

  private dispatch(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "hello_ack":
        break;

      case "frame":
        this.events.onFrame?.(msg as unknown as FrameMessage);
        break;

      case "buttons":
        this.events.onButtons?.(msg.buttons as number);
        break;

      case "motion_start":
        this.events.onMotionStart?.(msg.need as string[]);
        break;

      case "motion_end":
        this.events.onMotionEnd?.();
        break;

      case "profile":
        this.events.onProfile?.(
          msg.mode as NavigationMode,
          msg.active as string[],
        );
        break;

      case "axes":
        this.events.onAxes?.(msg.axes as string[]);
        break;

      case "camera.pose":
        this.events.onCameraPose?.(msg as unknown as CameraPoseMessage);
        break;

      case "camera.pivot":
        this.events.onCameraPivot?.(msg.point as [number, number, number]);
        break;

      case "object.pose":
        this.events.onObjectPose?.(msg as unknown as ObjectPoseMessage);
        break;

      case "object.pivot":
        this.events.onObjectPivot?.(msg.point as [number, number, number]);
        break;

      case "error":
        this.events.onError?.(msg.code as string, msg.message as string);
        break;
    }
  }

  private handleDisconnect(): void {
    this.stopHeartbeat();
    this.setState(ConnectionState.Disconnected);
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.events.onStateChange?.(state);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      try {
        this.send({ type: "heartbeat" });
      } catch {
        // ignore send errors during heartbeat
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}
