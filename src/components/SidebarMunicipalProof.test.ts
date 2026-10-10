// @vitest-environment happy-dom
// Integration proof: real Municipal data shape through the forked Sidebar.
// A user section with groups renders group rows only (no bot rows);
// bots keep working (state intact, only the sidebar row is hidden).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group } from "@/state/store";
import { BotEditorStore, initialState } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { Sidebar } from "./Sidebar";

vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => true,
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));

const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "bot", threadId: "thread-bot", name: "Bot", title: "", description: "",
  color: "green", notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "thread-bot", title: "Bot thread", createdAt: 1 }],
  ...overrides,
});
const group = (overrides: Partial<Group> = {}): Group => ({
  id: "group", threadId: "group-thread", name: "Team", memberIds: [],
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false,
  createdAt: 0, messages: [],
  tasks: [{ threadId: "group-thread", title: "Group conversation", createdAt: 1 }],
  ...overrides,
} as Group);

let state: AppState;
let root: Root;
let container: HTMLDivElement;
const dispatch = vi.fn();

function draw() {
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(Sidebar, { open: true, onClose: () => {} }) })));
}

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  dispatch.mockClear();
  state = { ...initialState, connected: true, selectedId: "", activeView: "chat", bots: [], groups: [], sections: [] };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  draw();
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("municipal project section (live shape)", () => {
  it("shows only team groups for a project section with members and groups", () => {
    state = {
      ...state,
      sections: ["Municipal"],
      bots: [
        bot({ id: "chief-id", threadId: "t-chief", name: "Orquestrador do projeto", section: "Municipal", chiefOfStaff: true }),
        bot({ id: "api-id", threadId: "t-api", name: "Backend — API e regras", section: "Municipal" }),
        bot({ id: "qa-id", threadId: "t-qa", name: "QA", section: "Municipal" }),
      ],
      groups: [
        group({ id: "equipe-municipal", name: "Equipe Municipal — pipeline-de-dados-municipais", section: "Municipal", memberIds: ["chief-id", "api-id", "qa-id"] }),
        group({ id: "equipe-qa", name: "Equipe Municipal — QA", section: "Municipal", memberIds: ["qa-id"] }),
      ],
    };
    draw();
    const section = container.querySelector('[data-sidebar-section-id="section:Municipal"]');
    expect(section).not.toBeNull();
    // both teams visible (multiple teams per project)
    expect(container.querySelector('[data-sidebar-group-row="equipe-municipal"]')).not.toBeNull();
    expect(container.querySelector('[data-sidebar-group-row="equipe-qa"]')).not.toBeNull();
    // no individual bot rows (chief included)
    expect(container.querySelector('[data-sidebar-bot-row="chief-id"]')).toBeNull();
    expect(container.querySelector('[data-sidebar-bot-row="api-id"]')).toBeNull();
    expect(container.querySelector('[data-sidebar-bot-row="qa-id"]')).toBeNull();
  });
});
