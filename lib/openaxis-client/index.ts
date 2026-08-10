/**
 * @openaxis/client - OpenAxis WebSocket client for browsers (v0.2)
 */

export { OpenAxisClient } from "./client";
export { ConnectionState, PROTO_VERSION } from "./types";
export { FocusManager, manageFocus } from "./focus-manager";
export type {
  OpenAxisClientEvents,
  OpenAxisClientOptions,
  PoseMode,
  Handedness,
  TranslationScaleMode,
  NavigationMode,
  HelloMessage,
  HelloAckMessage,
  HeartbeatMessage,
  ErrorMessage,
  TagsMessage,
  CapabilitiesMessage,
  SubscribeMessage,
  AxesMessage,
  ProfileMessage,
  FrameMessage,
  ButtonsMessage,
  MotionStartMessage,
  MotionEndMessage,
  CameraPoseMessage,
  CameraPivotMessage,
  ObjectPoseMessage,
  ObjectPivotMessage,
  WorldOrientationMessage,
  TranslationScaleMessage,
  NavigationPreferencesMessage,
} from "./types";
export type { FocusManagerOptions } from "./focus-manager";
