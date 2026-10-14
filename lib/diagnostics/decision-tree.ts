/**
 * Guided diagnostic decision tree (ported from dcptriage src/lib/triage-logic.ts).
 * Change from source: every result now carries one of the three tiers.
 *
 * AI Triage Assistant Core Logic
 * 
 * Defines the diagnostic question flow and decision trees for mobile device
 * hardware components (Screens, Batteries, Buttons).
 */

import type { TierId } from "../tiers";

export type HardwareComponent = "Screen" | "Battery" | "Button";

export interface DiagnosticQuestion {
  id: string;
  component: HardwareComponent;
  question: string;
  options: { label: string; nextId?: string; result?: string; tier?: TierId }[];
}

/**
 * The core decision tree mapping.
 * Note: These results focus strictly on diagnostics and do NOT reveal
 * internal business logic or pricing.
 */
export const TRIAGE_DECISION_TREE: Record<string, DiagnosticQuestion> = {
  // --- SCREEN DIAGNOSTICS ---
  "screen_start": {
    id: "screen_start",
    component: "Screen",
    question: "Is there visible physical damage to the glass or display panel?",
    options: [
      { label: "Yes, visible cracks", nextId: "screen_cracks" },
      { label: "No physical damage", nextId: "screen_visual_issue" }
    ]
  },
  "screen_cracks": {
    id: "screen_cracks",
    component: "Screen",
    question: "Does the touch function work perfectly despite the cracks?",
    options: [
      { label: "Yes, touch is fine", result: "DIAGNOSTIC: Outer digitizer/glass fracture. Recommended path: External glass restoration or full display assembly replacement.", tier: "TIER_2" },
      { label: "No, dead zones or ghost touch", result: "DIAGNOSTIC: Internal digitizer failure. Recommended path: Component-level display restoration.", tier: "TIER_2" }
    ]
  },
  "screen_visual_issue": {
    id: "screen_visual_issue",
    component: "Screen",
    question: "What is the primary visual symptom?",
    options: [
      { label: "Flickering or lines", result: "DIAGNOSTIC: IC driver instability or FPC connector misalignment. Recommended path: Electrical signal audit.", tier: "TIER_3" },
      { label: "Black screen (device on)", result: "DIAGNOSTIC: Backlight anode circuit fault or OLED panel failure. Recommended path: Motherboard-level power rail check.", tier: "TIER_3" },
      { label: "Discoloration/Ink spots", result: "DIAGNOSTIC: LCD/OLED leakage. Recommended path: Display panel replacement.", tier: "TIER_2" }
    ]
  },

  // --- BATTERY DIAGNOSTICS ---
  "battery_start": {
    id: "battery_start",
    component: "Battery",
    question: "What is the primary power-related concern?",
    options: [
      { label: "Rapid discharge", nextId: "battery_discharge" },
      { label: "Device won't turn on", nextId: "battery_dead" },
      { label: "Device gets very hot", result: "DIAGNOSTIC: Potential thermal runaway or short circuit. Recommended path: Immediate power disconnection and thermal audit.", tier: "TIER_3" }
    ]
  },
  "battery_discharge": {
    id: "battery_discharge",
    component: "Battery",
    question: "Does the device shut down suddenly while showing charge (e.g., at 20%)?",
    options: [
      { label: "Yes, sudden shutdowns", result: "DIAGNOSTIC: High internal cell resistance. Recommended path: Chemical cell restoration.", tier: "TIER_1" },
      { label: "No, just drains fast", result: "DIAGNOSTIC: Background parasitic draw or high cycle count. Recommended path: Cycle count verification and background process audit.", tier: "TIER_1" }
    ]
  },
  "battery_dead": {
    id: "battery_dead",
    component: "Battery",
    question: "Does the device show a charging icon when plugged in?",
    options: [
      { label: "Yes, charging icon appears", result: "DIAGNOSTIC: Deep discharge state. Recommended path: External cell activation.", tier: "TIER_1" },
      { label: "No response to charger", result: "DIAGNOSTIC: VBUS charging path failure or Tristar IC fault. Recommended path: Charging port electrical audit.", tier: "TIER_3" }
    ]
  },

  // --- BUTTON DIAGNOSTICS ---
  "button_start": {
    id: "button_start",
    component: "Button",
    question: "Which button is malfunctioning?",
    options: [
      { label: "Power Button", nextId: "button_physical" },
      { label: "Volume Buttons", nextId: "button_physical" },
      { label: "Mute Switch", nextId: "button_physical" }
    ]
  },
  "button_physical": {
    id: "button_physical",
    component: "Button",
    question: "Does the button still 'click' physically when pressed?",
    options: [
      { label: "Yes, it clicks", result: "DIAGNOSTIC: Internal flex ribbon trace fracture or logic board pull-up failure. Recommended path: Continuity check on the signal line.", tier: "TIER_3" },
      { label: "No, it feels mushy/stuck", result: "DIAGNOSTIC: Mechanical obstruction or dome switch collapse. Recommended path: Physical cleaning or mechanical switch restoration.", tier: "TIER_1" }
    ]
  }
};

/**
 * Gets the starting question for a component.
 */
export function getStartQuestion(component: HardwareComponent): DiagnosticQuestion {
  const map: Record<HardwareComponent, string> = {
    "Screen": "screen_start",
    "Battery": "battery_start",
    "Button": "button_start"
  };
  return TRIAGE_DECISION_TREE[map[component]];
}
