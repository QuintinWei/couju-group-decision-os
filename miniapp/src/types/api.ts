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
  members: Array<{
    id: string;
    name: string;
    origin: string;
    originLocation: { lng: number; lat: number } | null;
    budgetLabel: string;
    commuteLabel: string;
    constraintsReady: boolean;
    setting: string;
    note: string;
    extraction: unknown | null;
    submittedAt: string | null;
    availability?: Array<{ startAt: string; endAt: string }> | null;
    availabilitySubmitted?: boolean;
    choices: Record<string, Choice>;
    rejectionReasons?: Record<string, RejectionReason>;
    privateCandidates?: Candidate[];
    nominatedCandidate?: Candidate | null;
    refreshRequestRound: number | null;
    privateDiscoveryCompleted: boolean;
  }>;
  nominationCount: number;
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
