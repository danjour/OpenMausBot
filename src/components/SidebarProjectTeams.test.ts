// @vitest-environment happy-dom
// Project sections show teams (groups) only: with an empty query a user
// section holding ≥1 group renders the group and hides its member bots
// (chiefs and section bots), while sections without groups render bots as
// before, and an active search brings the bots back (findability > looks).
// Contract: partitionSidebarBots/partitionSidebarGroups untouched; the render
// in Sidebar.tsx:2562-2660 decides per section (group count + empty query).
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

const SEARCH_LABEL = "Search bots and messages";

// Locked in step across the three cases below: identical bot/group defaults,
// only ids, names and sections vary per case.
const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "bot",
  threadId: "thread-bot",
  name: "Bot",
  title: "",
  description: "",
  color: "green",
  notifications: true,
  unread: false,
  busy: false,
  messages: [],
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "thread-bot", title: "Bot thread", createdAt: 1 }],
  ...overrides,
});

const group = (overrides: Partial<Group> = {}): Group => ({
  id: "group",
  threadId: "group-thread",
  name: "Team",
  memberIds: [],
  defaultResponder: { kind: "mentions" },
  bulletin: "",
  unread: false,
  createdAt: 0,
  messages: [],
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

function sectionHtml(sectionId: string): string {
  const section = container.querySelector(`[data-sidebar-section-id="${sectionId}"]`);
  expect(section, sectionId).not.toBeNull();
  return section!.innerHTML;
}

function typeSearch(value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${SEARCH_LABEL}"]`)!;
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  dispatch.mockClear();
  state = {
    ...initialState,
    connected: true,
    selectedId: "",
    activeView: "chat",
    bots: [],
    groups: [],
    sections: [],
  };
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

describe("sidebar project teams", () => {
  it("hides member bots but shows the group in a section with groups and an empty query", () => {
    state = {
      ...state,
      sections: ["Apollo"],
      bots: [
        bot({ id: "atlas", threadId: "thread-atlas", name: "Atlas Member", section: "Apollo" }),
        bot({ id: "chief", threadId: "thread-chief", name: "Chief Coordinator", section: "Apollo", chiefOfStaff: true }),
      ],
      groups: [group({ id: "apollo-team", name: "Apollo Crew", section: "Apollo", memberIds: ["atlas"] })],
    };
    draw();
    const html = sectionHtml("section:Apollo");
    expect(html).toContain("Apollo Crew");
    expect(container.querySelector('[data-sidebar-group-row="apollo-team"]')).not.toBeNull();
    // Member names may linger in avatar tooltips (BotAvatar title); the
    // project contract is about rows: no bot rows in a project section.
    expect(container.querySelector('[data-sidebar-bot-row="atlas"]')).toBeNull();
    expect(container.querySelector('[data-sidebar-bot-row="chief"]')).toBeNull();
  });
  it("renders bots normally in a section without groups", () => {
    state = {
      ...state,
      sections: ["Solo"],
      bots: [bot({ id: "scout", threadId: "thread-scout", name: "Scout Solo", section: "Solo" })],
      groups: [],
    };
    draw();
    const html = sectionHtml("section:Solo");
    expect(html).toContain("Scout Solo");
    expect(container.querySelector('[data-sidebar-bot-row="scout"]')).not.toBeNull();
  });

  it("brings member bots back with an active search", () => {
    state = {
      ...state,
      sections: ["Apollo"],
      bots: [bot({ id: "atlas", threadId: "thread-atlas", name: "Atlas Member", section: "Apollo" })],
      groups: [group({ id: "apollo-team", name: "Apollo Crew", section: "Apollo", memberIds: ["atlas"] })],
    };
    draw();
    expect(container.querySelector('[data-sidebar-bot-row="atlas"]')).toBeNull();
    typeSearch("Atlas");
    expect(sectionHtml("section:Apollo")).toContain("Atlas Member");
    expect(container.querySelector('[data-sidebar-bot-row="atlas"]')).not.toBeNull();
  });
});
