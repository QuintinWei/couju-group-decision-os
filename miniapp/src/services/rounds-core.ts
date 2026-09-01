import type { Choice, Membership, ParticipantRoom, RejectionReason } from "../types/api.ts";
import type { ApiRequestOptions } from "./request-core.ts";

type ApiRequest = <T>(path: string, options?: ApiRequestOptions) => Promise<T>;

type SubmissionRoom = Pick<ParticipantRoom, "currentRound"> & {
  candidates: Array<Pick<ParticipantRoom["candidates"][number], "id">>;
};

type SubmissionMember = Pick<ParticipantRoom["members"][number], "budgetLabel" | "commuteLabel" | "setting" | "note" | "extraction">;

export function createRoundsService({ request }: { request: ApiRequest }) {
  async function submitSharedRound(
    membership: Membership,
    room: SubmissionRoom,
    member: SubmissionMember,
    choices: Record<string, Choice>,
    rejectionReasons: Record<string, RejectionReason>,
  ) {
    return request<{ ok: true }>("/api/members", {
      method: "PATCH",
      membership,
      data: {
        expectedRound: room.currentRound,
        budgetLabel: member.budgetLabel,
        commuteLabel: member.commuteLabel,
        setting: member.setting,
        note: member.note,
        extraction: member.extraction,
        choices,
        rejectionReasons,
      },
    });
  }

  return { submitSharedRound };
}
