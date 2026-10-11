// @vitest-environment happy-dom
// Channel YOLO controls: Ask by default, an explicit owner-reviewed scope,
// one confirmation on activation only, immediate disable, a permanent active
// indicator, and Stop execution while the room works — all owner-UI only.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import type { GroupYoloPolicy } from "../../shared/wire";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [] as Bot[] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

// Static import cannot work here: vi.mock must register before GroupView loads,
// the same reason every GroupView test imports it dynamically.
const { GroupView, RoomStopButton, RoomYoloChip, RoomYoloPanel } = await import("./GroupView");

const room = (patch: Partial<Group> = {}): Group => ({
  id: "room", threadId: "room-thread", name: "Launch planning", memberIds: [],
  defaultResponder: { kind: "member", botId: "atlas" }, bulletin: "", unread: false,
  createdAt: 1, setupCompletedAt: 1, cwd: "/tmp/room-desk", messages: [],
  ...patch,
});
const policy: GroupYoloPolicy = {
  mode: "yolo", workspace: "/tmp/room-desk", allowedTools: ["shell"],
  allowedIntegrations: [], externalWrites: { communications: false, publishing: false, payments: false, production: false },
  activatedAt: 1_700_000_000_000,
};

let host: HTMLDivElement;
let root: Root;
const render = (node: React.ReactElement) => flushSync(() => root.render(node));
const buttons = () => [...host.querySelectorAll("button")];
const buttonNamed = (text: string) => buttons().find((button) => button.textContent?.includes(text));
const chip = () => host.querySelector('[data-testid="room-yolo-chip"]');
const fetchMock = vi.fn();
const posted = async () => {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [path, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
  return { path, body: JSON.parse(String(init.body)) };
};

beforeEach(() => {
  fixture.dispatch.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ group: { id: "room" } }) });
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).ogb;
});

describe("RoomYoloChip", () => {
  it("reads Ask by default, with no active indicator", () => {
    render(createElement(RoomYoloChip, { group: room(), open: false, onToggle: () => {} }));
    expect(chip()?.textContent).toContain("Ask");
    expect(host.textContent).not.toContain("YOLO active");
  });

  it("shows a permanent YOLO active indicator once a policy is set", () => {
    render(createElement(RoomYoloChip, { group: room({ yolo: policy } as Group), open: false, onToggle: () => {} }));
    expect(chip()?.textContent).toContain("YOLO active");
  });
});

describe("owner-only gating", () => {
  it("shows no YOLO chip in a DM", () => {
    render(createElement(GroupView, { group: room({ dm: true }) }));
    expect(chip()).toBeNull();
  });

  it("shows no YOLO chip to a remote client", () => {
    (window as unknown as Record<string, unknown>).ogb = { remoteClient: { active: true } };
    render(createElement(GroupView, { group: room() }));
    expect(chip()).toBeNull();
  });

  it("shows no YOLO chip while setup is pending", () => {
    const pending = room();
    delete pending.setupCompletedAt;
    render(createElement(GroupView, { group: pending }));
    expect(chip()).toBeNull();
  });

  it("shows the Ask chip in the local owner header", () => {
    render(createElement(GroupView, { group: room() }));
    expect(chip()?.textContent).toContain("Ask");
  });
});

describe("RoomStopButton", () => {
  it("renders nothing while the room is idle", () => {
    render(createElement(RoomStopButton, { group: room() }));
    expect(host.querySelector('[data-testid="room-stop-execution"]')).toBeNull();
  });

  it("stops the exact running thread through the existing interrupt endpoint", async () => {
    render(createElement(RoomStopButton, { group: room({ working: true }) }));
    flushSync(() => buttonNamed("Stop execution")!.click());
    const { path, body } = await posted();
    expect(path).toBe("/api/groups/room/interrupt");
    expect(body).toEqual({ threadId: "room-thread" });
  });
});

describe("RoomYoloPanel", () => {
  it("reviews the approved folder, tool categories, integrations, external writes and limits", () => {
    render(createElement(RoomYoloPanel, { group: room(), onEditFolder: () => {} }));
    expect(host.textContent).toContain("Approved folder");
    expect(host.textContent).toContain("/tmp/room-desk");
    for (const label of ["Shell commands", "File reads and edits", "Web search and fetch", "Connected-app actions"]) {
      expect(host.textContent).toContain(label);
    }
    expect(host.querySelector("#room-yolo-integrations")).not.toBeNull();
    for (const label of ["Outbound messages", "Publishing and releases", "Payments and charges", "Production deploys"]) {
      expect(host.textContent).toContain(label);
    }
    // External writes are all off by default.
    expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);
    expect(host.querySelector("#room-yolo-max-actions")).not.toBeNull();
    expect(host.querySelector("#room-yolo-max-minutes")).not.toBeNull();
    expect(host.textContent).toContain("Enable YOLO");
  });

  it("confirms exactly once on activation, then persists the reviewed scope", async () => {
    render(createElement(RoomYoloPanel, { group: room(), onEditFolder: () => {} }));
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    flushSync(() => buttonNamed("Enable YOLO")!.click());
    // One informative confirmation before saving — never per action.
    expect(host.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(buttonNamed("Confirm and enable")).not.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    flushSync(() => buttonNamed("Confirm and enable")!.click());
    const { path, body } = await posted();
    expect(path).toBe("/api/groups/room");
    expect(body).toEqual({
      yolo: {
        mode: "yolo", workspace: "/tmp/room-desk", allowedTools: [], allowedIntegrations: [],
        externalWrites: { communications: false, publishing: false, payments: false, production: false },
        activatedAt: expect.any(Number),
      },
    });
  });

  it("persists a ticked tool category with the policy", async () => {
    render(createElement(RoomYoloPanel, { group: room(), onEditFolder: () => {} }));
    const shell = [...host.querySelectorAll('input[type="checkbox"]')]
      .find((input) => input.closest("label")?.textContent?.includes("Shell commands"))!;
    flushSync(() => (shell as HTMLElement).click());
    flushSync(() => buttonNamed("Enable YOLO")!.click());
    flushSync(() => buttonNamed("Confirm and enable")!.click());
    const { body } = await posted();
    expect(body.yolo.allowedTools).toEqual(["shell"]);
  });

  it("disables immediately with a null patch and no confirmation step", async () => {
    render(createElement(RoomYoloPanel, { group: room({ yolo: policy } as Group), onEditFolder: () => {} }));
    expect(buttonNamed("Disable YOLO")).not.toBeUndefined();
    flushSync(() => buttonNamed("Disable YOLO")!.click());
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    const { path, body } = await posted();
    expect(path).toBe("/api/groups/room");
    expect(body).toEqual({ yolo: null });
  });

  it("refuses an invalid limit without touching the backend", () => {
    render(createElement(RoomYoloPanel, { group: room(), onEditFolder: () => {} }));
    const field = host.querySelector("#room-yolo-max-actions") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
    flushSync(() => {
      setter.call(field, "0");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => buttonNamed("Enable YOLO")!.click());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
