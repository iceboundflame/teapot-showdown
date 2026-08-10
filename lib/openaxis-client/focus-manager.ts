/**
 * Focus Manager for OpenAxis Client
 *
 * Connection policy layer: connects on focus, disconnects on blur.
 * Supports pausing (suppresses auto-reconnect) via public pause()/resume().
 * Input hooks (Esc, click, etc.) are the consumer's responsibility.
 */

import { OpenAxisClient } from "./client";
import { ConnectionState } from "./types";

export interface FocusManagerOptions {
  /** Whether to start managing focus immediately (default: true) */
  autoStart?: boolean;
  /** Delay in ms before connecting after focus (default: 0) */
  connectDelay?: number;
  /** Delay in ms before disconnecting after blur (default: 0) */
  disconnectDelay?: number;
  /** Called when pause state changes */
  onPauseChange?: (paused: boolean) => void;
  /** Whether to log connection state changes (default: false) */
  debug?: boolean;
}

type ResolvedOptions = Omit<Required<FocusManagerOptions>, "onPauseChange"> &
  Pick<FocusManagerOptions, "onPauseChange">;

/**
 * Manages automatic connection/disconnection based on window focus
 */
export class FocusManager {
  private client: OpenAxisClient;
  private options: ResolvedOptions;
  private isActive: boolean = false;
  private _paused: boolean = false;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  private boundFocusHandler = this.handleFocus.bind(this);
  private boundBlurHandler = this.handleBlur.bind(this);

  constructor(client: OpenAxisClient, options: FocusManagerOptions = {}) {
    this.client = client;
    this.options = {
      autoStart: true,
      connectDelay: 0,
      disconnectDelay: 0,
      debug: false,
      ...options,
    };

    if (this.options.autoStart) {
      this.start();
    }
  }

  /**
   * Start managing focus events
   */
  start(): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    window.addEventListener("focus", this.boundFocusHandler);
    window.addEventListener("blur", this.boundBlurHandler);

    // Connect immediately if page is already focused
    if (document.hasFocus()) {
      this.handleFocus();
    }

    if (this.options.debug) {
      console.log("[FocusManager] Started managing focus events");
    }
  }

  /**
   * Stop managing focus events
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    window.removeEventListener("focus", this.boundFocusHandler);
    window.removeEventListener("blur", this.boundBlurHandler);

    // Clear any pending timeouts
    this.clearTimeouts();

    if (this.options.debug) {
      console.log("[FocusManager] Stopped managing focus events");
    }
  }

  /**
   * Disconnect and stop managing (cleanup)
   */
  destroy(): void {
    this.stop();

    // Disconnect if currently connected
    const state = this.client.getState();
    if (state === ConnectionState.Connected || state === ConnectionState.Connecting) {
      this.client.disconnect();
    }

    if (this.options.debug) {
      console.log("[FocusManager] Destroyed");
    }
  }

  /**
   * Check if focus management is active
   */
  isManaging(): boolean {
    return this.isActive;
  }

  /**
   * Check if connection is paused
   */
  isPaused(): boolean {
    return this._paused;
  }

  /**
   * Pause: disconnect and suppress auto-reconnect until resume() is called.
   * No-op if already paused.
   */
  pause(): void {
    if (this._paused) return;

    this._paused = true;
    this.options.onPauseChange?.(true);
    this.clearTimeouts();

    const state = this.client.getState();
    if (state === ConnectionState.Connected || state === ConnectionState.Connecting) {
      this.doDisconnect();
    }

    if (this.options.debug) {
      console.log("[FocusManager] Paused");
    }
  }

  /**
   * Resume: clear pause state and reconnect if the page has focus.
   * No-op if not paused.
   */
  resume(): void {
    if (!this._paused) return;

    this._paused = false;
    this.options.onPauseChange?.(false);

    if (document.hasFocus() && this.client.getState() === ConnectionState.Disconnected) {
      this.doConnect();
    }

    if (this.options.debug) {
      console.log("[FocusManager] Resumed");
    }
  }

  private handleFocus(): void {
    // Clear any pending disconnect
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }

    // Don't auto-connect while paused
    if (this._paused) return;

    const state = this.client.getState();

    // Only connect if disconnected
    if (state === ConnectionState.Disconnected) {
      if (this.options.connectDelay > 0) {
        this.connectTimeout = setTimeout(() => {
          this.doConnect();
        }, this.options.connectDelay);
      } else {
        this.doConnect();
      }
    }
  }

  private handleBlur(): void {
    // Clear any pending connect
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }

    const state = this.client.getState();

    // Only disconnect if connected or connecting
    if (state === ConnectionState.Connected || state === ConnectionState.Connecting) {
      if (this.options.disconnectDelay > 0) {
        this.disconnectTimeout = setTimeout(() => {
          this.doDisconnect();
        }, this.options.disconnectDelay);
      } else {
        this.doDisconnect();
      }
    }
  }

  private async doConnect(): Promise<void> {
    if (this.options.debug) {
      console.log("[FocusManager] Connecting...");
    }

    try {
      await this.client.connect();
      if (this.options.debug) {
        console.log("[FocusManager] Connected");
      }
    } catch (error) {
      if (this.options.debug) {
        console.error("[FocusManager] Failed to connect:", error);
      }
    }
  }

  private doDisconnect(): void {
    if (this.options.debug) {
      console.log("[FocusManager] Disconnecting...");
    }

    this.client.disconnect();

    if (this.options.debug) {
      console.log("[FocusManager] Disconnected");
    }
  }

  private clearTimeouts(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }
  }
}

/**
 * Helper function to create and start a FocusManager
 */
export function manageFocus(
  client: OpenAxisClient,
  options?: FocusManagerOptions
): FocusManager {
  return new FocusManager(client, options);
}
