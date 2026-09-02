import type { ParticipantRoom } from "../types/api.ts";

export type RoomPage = "room" | "availability" | "constraints" | "swipe" | "result";

export type MemberSetupProgress = {
  id: string;
  name: string;
  isSelf: boolean;
  availabilityReady: boolean;
  constraintsReady: boolean;
};

export function nextRequiredPage(room: ParticipantRoom, memberId: string): RoomPage {
  const currentMember = room.members.find((member) => member.id === memberId);
  if (!currentMember) return "room";
  if (!availabilityReady(currentMember)) return "availability";
  if (!currentMember.constraintsReady) return "constraints";
  if (currentMember.submittedAt) return room.members.length === room.config.people && room.members.every((member) => Boolean(member.submittedAt)) ? "result" : "room";
  if (room.members.length !== room.config.people) return "room";
  if (!room.members.every(availabilityReady) || room.members.some((member) => !member.constraintsReady)) return "room";
  if (!allMembersShareSchedule(room)) return "availability";
  if (room.currentRound === 1 && room.meta?.groupIntersection !== true) return "constraints";
  return "swipe";
}

export function memberSetupProgress(room: ParticipantRoom, memberId: string): MemberSetupProgress[] {
  return room.members.map((member) => ({
    id: member.id,
    name: member.name,
    isSelf: member.id === memberId,
    availabilityReady: availabilityReady(member),
    constraintsReady: member.constraintsReady,
  }));
}

function availabilityReady(member: ParticipantRoom["members"][number]) {
  return ("availability" in member && Array.isArray(member.availability)) || member.availabilitySubmitted;
}

function allMembersShareSchedule(room: ParticipantRoom) {
  const attendees = room.config.resolvedSchedule?.attendeeIds ?? [];
  return attendees.length === room.config.people && room.members.every((member) => attendees.includes(member.id));
}
