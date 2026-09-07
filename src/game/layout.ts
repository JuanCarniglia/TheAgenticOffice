import type { AgentId, ZoneId } from "../shared/types.js";
import { AGENT_IDS } from "../shared/roster.js";

/** Percentage anchors on the isometric floorplan (origin top-left of the image). */
export const ZONES: Record<ZoneId, { nx: number; ny: number; label: string }> = {
  entrance: { nx: 0.1, ny: 0.62, label: "Entrance" },
  reception: { nx: 0.32, ny: 0.59, label: "Reception" },
  waiting: { nx: 0.16, ny: 0.4, label: "Waiting" },
  manager_office: { nx: 0.33, ny: 0.33, label: "Manager" },
  conference_room: { nx: 0.46, ny: 0.24, label: "Conference" },
  bullpen_sales: { nx: 0.4, ny: 0.52, label: "Jim" },
  bullpen_dwight: { nx: 0.42, ny: 0.54, label: "Dwight" },
  accounting: { nx: 0.57, ny: 0.63, label: "Accounting" },
  water_cooler: { nx: 0.5, ny: 0.58, label: "Cooler" },
  kitchen: { nx: 0.62, ny: 0.32, label: "Kitchen" },
  breakroom: { nx: 0.72, ny: 0.38, label: "Breakroom" },
  annex: { nx: 0.82, ny: 0.52, label: "Annex" },
};

/** Unique stand-slots so two workers in the same zone never stack. */
const AGENT_SLOT: Record<AgentId, { x: number; y: number }> = {
  michael: { x: 0, y: -6 },
  pam: { x: -30, y: 2 },
  jim: { x: -20, y: 12 },
  dwight: { x: 22, y: -10 },
  angela: { x: 10, y: 14 },
};

export function zoneWorldPos(
  zone: ZoneId,
  map: { x: number; y: number; displayWidth: number; displayHeight: number },
  agentId?: AgentId,
): { x: number; y: number } {
  const a = ZONES[zone];
  const slot = agentId ? AGENT_SLOT[agentId] : { x: 0, y: 0 };
  let extraX = 0;
  let extraY = 0;
  if (zone === "conference_room" && agentId) {
    const i = AGENT_IDS.indexOf(agentId);
    extraX = (i - 2) * 24;
    extraY = (i % 2) * 18;
  }
  return {
    x: map.x - map.displayWidth / 2 + a.nx * map.displayWidth + slot.x + extraX,
    y: map.y - map.displayHeight / 2 + a.ny * map.displayHeight + slot.y + extraY,
  };
}

export function worldToNorm(
  x: number,
  y: number,
  map: { x: number; y: number; displayWidth: number; displayHeight: number },
): { nx: number; ny: number } {
  return {
    nx: (x - (map.x - map.displayWidth / 2)) / map.displayWidth,
    ny: (y - (map.y - map.displayHeight / 2)) / map.displayHeight,
  };
}
