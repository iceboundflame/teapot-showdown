/**
 * OpenAxis Protocol Types (v0.2)
 */

export const PROTO_VERSION = "openaxis/0.2";

// Type aliases

export type PoseMode = "absolute" | "relative";
export type Handedness = "right" | "left";
export type TranslationScaleMode = "viewport" | "absolute";
export type NavigationMode = "orbit" | "walk" | "fly" | "object";

// Connection state

export enum ConnectionState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Connected = "connected",
  Disconnecting = "disconnecting",
}

// Message interfaces

export interface HelloMessage {
  type: "hello";
  proto: string;
  client_name: string;
}

export interface HelloAckMessage {
  type: "hello_ack";
  proto: string;
  server_name: string;
}

export interface HeartbeatMessage {
  type: "heartbeat";
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export interface TagsMessage {
  type: "tags";
  tags: string[];
}

export interface CapabilitiesMessage {
  type: "capabilities";
  capabilities: string[];
}

export interface SubscribeMessage {
  type: "subscribe";
  axes: string[];
}

export interface AxesMessage {
  type: "axes";
  axes: string[];
}

export interface ProfileMessage {
  type: "profile";
  mode: NavigationMode;
  active: string[];
}

export interface FrameMessage {
  type: "frame";
  seq: number;
  t_us: number;
  values: number[];
}

export interface ButtonsMessage {
  type: "buttons";
  buttons: number;
}

export interface MotionStartMessage {
  type: "motion_start";
  need: string[];
}

export interface MotionEndMessage {
  type: "motion_end";
}

export interface CameraPoseMessage {
  type: "camera.pose";
  t: [number, number, number];
  r: [number, number, number];
  mode: PoseMode;
  fov?: number;
  ortho_extent?: number;
}

export interface CameraPivotMessage {
  type: "camera.pivot";
  point: [number, number, number];
}

export interface ObjectPoseMessage {
  type: "object.pose";
  t: [number, number, number];
  r: [number, number, number];
  mode: PoseMode;
}

export interface ObjectPivotMessage {
  type: "object.pivot";
  point: [number, number, number];
}

export interface WorldOrientationMessage {
  type: "world_orientation";
  forward: [number, number, number];
  up: [number, number, number];
  handedness?: Handedness;
}

export interface TranslationScaleMessage {
  type: "translation_scale";
  mode: TranslationScaleMode;
  translation_scale: number;
}

export interface NavigationPreferencesMessage {
  type: "navigation_preferences";
  recenter_on_pan?: boolean;
  lock_pitch?: boolean;
  lock_yaw?: boolean;
  lock_roll?: boolean;
  lock_translation_plane?: boolean;
}

// Client options

export interface OpenAxisClientOptions {
  /** WebSocket server URL (default: ws://127.0.0.1:6607) */
  url?: string;
  /**
   * Candidate server URLs tried in order on each connect() until one
   * opens (a successful URL is remembered and tried first next time).
   * Takes precedence over `url`. Lets an https-served page fall back
   * between ws://localhost (blocked on secure origins by most
   * browsers) and the host's local-HTTPS wss listener.
   */
  urls?: string[];
  /** Client name for the hello handshake */
  clientName: string;
  /** Tags sent automatically on connect */
  tags?: string[];
  /** Capabilities sent automatically on connect (e.g. ["3d"]) */
  capabilities?: string[];
  /** Axes to subscribe to on connect (e.g. ["vx","vy","vz","wx","wy","wz"]) */
  axes?: string[];
}

// Event callbacks

export interface OpenAxisClientEvents {
  onFrame?: (frame: FrameMessage) => void;
  onButtons?: (buttons: number) => void;
  onMotionStart?: (need: string[]) => void;
  onMotionEnd?: () => void;
  onProfile?: (mode: NavigationMode, active: string[]) => void;
  onAxes?: (axes: string[]) => void;
  onCameraPose?: (pose: CameraPoseMessage) => void;
  onCameraPivot?: (point: [number, number, number]) => void;
  onObjectPose?: (pose: ObjectPoseMessage) => void;
  onObjectPivot?: (point: [number, number, number]) => void;
  onStateChange?: (state: ConnectionState) => void;
  onError?: (code: string, message: string) => void;
}
