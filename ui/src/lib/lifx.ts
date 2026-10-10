type Bridge = {
  core: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  event?: {
    listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
  };
};

function bridge(): Bridge | null {
  const tauri = (window as Window & { __TAURI__?: Bridge }).__TAURI__;
  return tauri ?? null;
}

export function sidecarAvailable() {
  return bridge() !== null;
}

export async function lifx(method: string, params?: Record<string, unknown>) {
  const host = bridge();
  if (!host) return null;
  return host.core.invoke("lifx_request", { method, params: params ?? {} });
}

export async function onSidecarEvent(handler: (payload: unknown) => void) {
  const listen = bridge()?.event?.listen;
  if (!listen) return;
  await listen("staylit", (event) => handler(event.payload));
}

export async function hideWindow() {
  const host = bridge();
  if (!host) return;
  await host.core.invoke("hide_window");
}
