export type DecisionKind = "activity" | "dining";
export type Choice = "no" | "okay" | "like";

export type Session = {
  accessToken: string;
  user: {
    id: string;
    nickname: string;
  };
};

/** Local member credentials deliberately use memberToken; the API still expects token. */
export type Membership = {
  roomCode: string;
  memberId: string;
  memberToken: string;
};

export type ResolvedSchedule = {
  startAt: string;
  endAt: string;
  attendeeIds: string[];
};

export type RoomSummary = {
  code: string;
  title: string;
  kind: DecisionKind;
  city: string;
  date: string;
  startTime: string;
  endTime: string;
  dateRange: { start: string; end: string };
  preferredPeriods: Array<"morning" | "afternoon" | "evening">;
  durationMinutes: 120 | 180 | 240 | "240_plus" | null;
  resolvedSchedule: ResolvedSchedule | null;
  targetCount: number;
  joinedCount: number;
  status: "open" | "full";
};

export type Candidate = {
  id: string;
  kind: DecisionKind;
  city: string;
  type: string;
  name: string;
  meta: string;
  image: string;
  priceValue: number | null;
  priceLabel: string;
  durationMinutes: number;
  durationLabel: string;
  address: string;
  district: string;
  location: { lng: number; lat: number } | null;
  estimatedTravelMinutes: number | null;
  rating: number | null;
  openToday: string | null;
  segment?: "nomination" | "learned" | "explore";
  source: { mode: "live" | "demo"; label: string; fetchedAt: string; providerId?: string; url?: string };
  features: {
    indoor: boolean | null;
    quiet: boolean | null;
    conversationFriendly: boolean | null;
    nonSpicyAvailable: boolean | null;
    queueRisk: "low" | "medium" | "high" | null;
  };
};

export type RejectionReason = {
  code: "distance" | "price" | "category" | "place" | "other";
  detail?: string;
};

export type ParticipantMemberStatus = {
  id: string;
  name: string;
  locationReady: boolean;
  availabilitySubmitted: boolean;
  constraintsReady: boolean;
  submittedAt: string | null;
  refreshRequestRound: number | null;
  privateDiscoveryCompleted: boolean;
};

export type ParticipantSelfMember = ParticipantMemberStatus & {
  origin: string;
  originLocation: { lng: number; lat: number } | null;
  budgetLabel: string;
  commuteLabel: string;
  setting: string;
  note: string;
  extraction: unknown | null;
  availability: Array<{ startAt: string; endAt: string }> | null;
  choices: Record<string, Choice>;
  rejectionReasons: Record<string, RejectionReason>;
  privateCandidates: Candidate[];
  nominatedCandidate: Candidate | null;
};

export function isParticipantSelfMember(member: ParticipantMemberStatus | ParticipantSelfMember): member is ParticipantSelfMember {
  return "choices" in member;
}

export type ParticipantRanking = Candidate & {
  groupFit: number;
  minUtility: number;
  meanUtility: number;
  geoMean: number;
  evidence: string[];
  explanation: string;
  memberUtilities: Array<{ memberId: string; name: string; utility: number; travelMinutes: number | null }>;
  meanTravelMinutes: number | null;
  onParetoFrontier: boolean;
};

export type ParticipantConflict = {
  type: "all_rejected" | "choice_rejection" | "commute" | "budget" | "duration" | "no_spicy" | "unknown_hard_fact";
  memberId?: string;
  affectedCount: number;
  message: string;
};

export type ParticipantCommuteRelaxation = {
  memberId: string;
  memberName: string;
  currentMinutes: number;
  suggestedMinutes: number;
  addedMinutes: number;
  restoredCandidateCount: number;
};

export type ParticipantRoom = {
  code: string;
  config: {
    kind: DecisionKind;
    city: string;
    people: number;
    dateRange: { start: string; end: string };
    preferredPeriods: Array<"morning" | "afternoon" | "evening">;
    durationMinutes: 120 | 180 | 240 | "240_plus" | null;
    resolvedSchedule: ResolvedSchedule | null;
    date: string;
    startTime: string;
    endTime: string;
  };
  candidates: Candidate[];
  meta: {
    mode: "live" | "demo";
    label: string;
    fetchedAt: string;
    groupIntersection?: boolean;
  };
  currentRound: number;
  roundHistory: Array<{ round: number }>;
  members: Array<ParticipantSelfMember | ParticipantMemberStatus>;
  nominationCount: number;
  decision: {
    rankings: ParticipantRanking[];
    conflicts: ParticipantConflict[];
    commuteRelaxation: ParticipantCommuteRelaxation | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type RoundInsight = {
  mode: "deepseek" | "deterministic";
  learned: string;
  conflict: string;
  nextRound: string;
};

export type AiExplanation = {
  headline: string;
  reasoning: string;
  tradeoff: string;
};
